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
                return Array.from(output.data);
            })
        );
        return embeddings;
    }

    async embedQuery(text) {
        const model = await this._getModel();
        const output = await model(text, { pooling: 'mean', normalize: true });
        return Array.from(output.data);
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

    const embeddings = new LocalEmbeddings();

    const vectorStore = await QdrantVectorStore.fromExistingCollection(
        embeddings,
        {
            url: 'http://localhost:6333',
            collectionName: 'langchainjs-testing',
        }
    );

    // Increase k to get more relevant documents (5-10 is usually good)
    const ret = vectorStore.asRetriever({
        k: 5
    })

    const result = await ret.invoke(userQuery);

    // Format the context better - extract pageContent from documents
    const contextText = result.map((doc, index) => {
        const content = doc.pageContent || doc.content || JSON.stringify(doc);
        return `[Document ${index + 1}]:\n${content}\n`;
    }).join('\n---\n\n');

    const SYSTEM_PROMPT = `You are a helpful AI Assistant who answers user queries based on the available context from PDF files.

IMPORTANT: 
- Answer ONLY based on the provided context
- If the context doesn't contain the answer, say "I don't have that information in the provided documents"
- Be specific and cite relevant details from the context
- For fee-related queries, provide exact amounts and details when available

Context from documents:
${contextText}`;
    
    const chatResult = await client.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [
            {role: 'system', content: SYSTEM_PROMPT},
            {role: 'user', content: userQuery},
        ],
        temperature: 0.7,
    })

    return res.json(
        {
            message: chatResult.choices[0].message.content,
            docs: result.map(doc => ({
                pageContent: doc.pageContent || doc.content,
                metadata: doc.metadata
            })),
        }
    )
})

app.listen(8000, () => {
    console.log('Server is running on port 8000')
})