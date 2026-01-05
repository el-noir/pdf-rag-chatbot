import express from 'express'
import cors from 'cors'
import multer from 'multer'
import {Queue} from 'bullmq'
import path from 'path'
import { fileURLToPath } from 'url'
import Groq from 'groq-sdk/index.mjs'
import dotenv from 'dotenv'
import { pipeline } from '@xenova/transformers';
import { QdrantVectorStore } from "@langchain/qdrant";
import { Embeddings } from "@langchain/core/embeddings";
import { enhancedRetrieval } from './query-enhancer.js';

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const client = new Groq({
    apiKey: process.env.GROQ_API_KEY
})

class LocalEmbeddings extends Embeddings {
    constructor() {
        super();
        this.model = null;
    }

    async _getModel() {
        if (!this.model) {
            // Using a fast, accurate model that runs entirely locally
            this.model = await pipeline(
                'feature-extraction',
                'Xenova/all-MiniLM-L6-v2'
            );
        }
        return this.model;
    }

    async embedDocuments(texts) {
        const model = await this._getModel();
        // Handle both string arrays and Document arrays
        const textStrings = texts.map(text => 
            typeof text === 'string' ? text : text.pageContent || text.content || String(text)
        );
        const embeddings = await Promise.all(
            textStrings.map(async (text) => {
                const output = await model(text, { pooling: 'mean', normalize: true });
                const embedding = Array.from(output.data);
                // L2 normalize
                const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
                return magnitude > 0 ? embedding.map(v => v / magnitude) : embedding;
            })
        );
        return embeddings;
    }

    async embedQuery(text) {
        const model = await this._getModel();
        const output = await model(text, { pooling: 'mean', normalize: true });
        const embedding = Array.from(output.data);
        // L2 normalize
        const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
        return magnitude > 0 ? embedding.map(v => v / magnitude) : embedding;
    }
}


const queue = new Queue('file-upload-queue', {
    connection: {
        host: 'localhost',
        port: 6379
    }
})

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'uploads'))
    },
    filename: function(req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
        cb(null, `${uniqueSuffix}-${file.originalname}`)
    }
})
const upload = multer({ storage: storage })


const app = express()

app.use(cors())
app.use(express.json())

app.post('/upload/pdf', upload.single('pdf'), async (req, res) => {
    await queue.add('file-ready', 
        JSON.stringify({
            filename: req.file.filename,
            destination: req.file.destination,
            path: req.file.path
        })
    )
    res.status(200).json({ message: 'File uploaded successfully' })
})

app.get('/chat', async (req, res)=>{
    // Get the query from request parameters
    const userQuery = req.query.message
    
    if (!userQuery) {
        return res.status(400).json({ error: 'Please provide a message query parameter' })
    }

    console.log(`[${new Date().toISOString()}] Query: "${userQuery}"`);

    const embeddings = new LocalEmbeddings();

    const vectorStore = await QdrantVectorStore.fromExistingCollection(
        embeddings,
        {
            url: 'http://localhost:6333',
            collectionName: 'air-university2',
        }
    );

    // Use enhanced retrieval for better results
    const { results, formatted, stats } = await enhancedRetrieval(
        vectorStore,
        userQuery,
        {
            topK: 15,              // Retrieve more candidates
            finalK: 5,             // Return top 5 after reranking
            useEnhancement: true,  // Enhance query
            useReranking: true,    // Rerank by quality
            deduplicate: true,     // Remove duplicates
        }
    );

    console.log(`[${new Date().toISOString()}] Retrieved: ${stats.retrieved} → Final: ${stats.final}`);
    results.forEach(([doc, score], i) => {
        console.log(`  ${i + 1}. Score: ${score.toFixed(4)} - ${doc.pageContent.slice(0, 100)}...`);
    });

    // Extract documents from results
    const retrievedDocs = results.map(([doc, score]) => ({
        pageContent: doc.pageContent,
        metadata: doc.metadata,
        score: score
    }));

    // Use the pre-formatted context
    const contextText = formatted;

    const SYSTEM_PROMPT = `You are the Air University AI Assistant. Provide clear, concise, and helpful answers to students and faculty.

### RULES:
1. **Answer ONLY from the provided documents** - Never make up information
2. **Be direct and concise** - Get to the point immediately
3. **Use clean formatting**:
   - Start with the main answer (no introduction)
   - Use simple bullet points (•) not nested bullets
   - Use **bold** for important terms
   - Keep paragraphs short (2-3 lines max)
   - Use clear section headers when needed

4. **Avoid these**:
   - ❌ Don't say "Based on the provided documents..."
   - ❌ Don't repeat "unfortunately" or "I couldn't find"
   - ❌ Don't list what's missing at the end
   - ❌ Don't use phrases like "It is recommended to check..."
   - ❌ Don't use document citations like [Document 1] unless critical
   - ❌ Don't add "Additional Notes" or "Important Notes" sections

5. **If information is missing**: Simply state what you know and say "For specific details, please contact [relevant office]" at the end

6. **Format examples**:

Good:
"**Dress Code for Male Students:**
• Formal trousers with tucked-in shirts
• Black or brown shoes
• No shorts, T-shirts, or ripped jeans

**Dress Code for Female Students:**
• Modest and professional attire
• No revealing outfits

Improperly dressed students may be fined or asked to leave."

Bad:
"**Dress Code Policy:**
Unfortunately, the provided documents mention that... [verbose explanation]
**Additional Notes:** It is important to note that..."

### CONTEXT:
${contextText}

Answer directly and concisely:`;
    
    const chatResult = await client.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [
            {role: 'system', content: SYSTEM_PROMPT},
            {role: 'user', content: userQuery},
        ],
        temperature: 0.2,  // Very low for consistent, focused responses
        max_tokens: 800,   // Moderate length - concise but complete
    })

    // Clean up response
    let response = chatResult.choices[0].message.content;
    
    // Remove common verbose patterns
    response = response.replace(/^(Based on the provided documents?[,:]?\s*)/i, '');
    response = response.replace(/^(According to the documents?[,:]?\s*)/i, '');
    response = response.replace(/Unfortunately,?\s*/gi, '');
    response = response.replace(/\[Document \d+\]\s*/g, ''); // Remove document citations in text
    response = response.replace(/\(Relevance:[\s\d.%]+\)/g, ''); // Remove relevance scores
    
    // Clean up excessive "Important Notes" or "Additional Information" sections at the end
    response = response.replace(/\n\n#{1,3}\s*(Important Notes?|Additional Information|Additional Notes?|Note):?\s*\n[\s\S]*?(check|contact|visit|recommended|may vary)[\s\S]*$/i, '');
    
    // Trim excessive whitespace
    response = response.replace(/\n{3,}/g, '\n\n').trim();

    return res.json(
        {
            message: response,
            docs: retrievedDocs,
        }
    )
})

app.listen(8000, () => {
    console.log('Server is running on port 8000')
})