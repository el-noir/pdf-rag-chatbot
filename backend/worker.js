import { Worker } from "bullmq";
import { QdrantVectorStore } from "@langchain/qdrant";
import { Embeddings } from "@langchain/core/embeddings";
import { UnstructuredLoader } from "@langchain/community/document_loaders/fs/unstructured"


import path from 'path'
import { fileURLToPath } from 'url'
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import dotenv from 'dotenv'
import { pipeline } from '@xenova/transformers';

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ============= UTILITY FUNCTIONS =============

// Clean and preprocess text
function cleanText(text) {
    if (!text || typeof text !== 'string') return '';
    
    // Remove excessive whitespace
    let cleaned = text.replace(/\s+/g, ' ');
    
    // Remove common PDF artifacts
    cleaned = cleaned.replace(/\f/g, ''); // form feed
    cleaned = cleaned.replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F]/g, ''); // control chars
    
    // Remove repeated headers/footers patterns (common in PDFs)
    // Pattern: same short line repeated multiple times
    const lines = cleaned.split('\n');
    const lineFreq = {};
    lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed.length > 0 && trimmed.length < 100) {
            lineFreq[trimmed] = (lineFreq[trimmed] || 0) + 1;
        }
    });
    
    // Remove lines that appear more than 3 times (likely headers/footers)
    const repeatedLines = Object.keys(lineFreq).filter(line => lineFreq[line] > 3);
    repeatedLines.forEach(line => {
        cleaned = cleaned.split(line).join('');
    });
    
    // Remove excessive newlines
    cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n');
    
    return cleaned.trim();
}

// Calculate cosine similarity between two vectors
function cosineSimilarity(a, b) {
    if (a.length !== b.length) return 0;
    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return dotProduct / (magA * magB + 1e-12);
}

// L2 normalize a vector
function normalize(vector) {
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return magnitude > 0 ? vector.map(v => v / magnitude) : vector;
}

// Filter out chunks that are too short or empty
function isValidChunk(text) {
    const cleaned = text.trim();
    return cleaned.length >= 50 && // at least 50 chars for meaningful content
           cleaned.split(/\s+/).length >= 8 && // at least 8 words
           /[a-zA-Z]/.test(cleaned); // contains letters
}

// Extract section headers from text (titles, headings)
function extractSectionHeader(text, index, allDocs) {
    // Look back a few lines to find potential headers
    const lines = text.split('\n');
    const firstLine = lines[0]?.trim();
    
    // Check if first line looks like a header (short, capitalized, no period at end)
    if (firstLine && 
        firstLine.length < 100 && 
        firstLine.length > 3 &&
        /[A-Z]/.test(firstLine[0]) &&
        !firstLine.endsWith('.') &&
        firstLine.split(' ').length <= 15) {
        return firstLine;
    }
    
    // Look for ALL CAPS headers
    const capsHeader = lines.find(line => {
        const trimmed = line.trim();
        return trimmed.length > 3 && 
               trimmed.length < 100 && 
               trimmed === trimmed.toUpperCase() &&
               /[A-Z]/.test(trimmed);
    });
    
    if (capsHeader) return capsHeader.trim();
    
    return null;
}

// Enrich chunk with context (header, position)
function enrichChunk(doc, index, allDocs) {
    const header = extractSectionHeader(doc.pageContent, index, allDocs);
    
    let enrichedContent = doc.pageContent;
    let metadata = { ...doc.metadata };
    
    // Prepend header if found and not already at start
    if (header && !doc.pageContent.trim().startsWith(header)) {
        enrichedContent = `${header}\n\n${doc.pageContent}`;
        metadata.section = header;
    }
    
    // Add chunk position metadata
    metadata.chunkIndex = index;
    
    return {
        ...doc,
        pageContent: enrichedContent,
        metadata
    };
}

// ============= EMBEDDINGS CLASS =============

// Custom free embeddings class using @xenova/transformers (runs locally, no API needed)
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
                // Already normalized by the model, but ensure L2 normalization
                return normalize(embedding);
            })
        );
        return embeddings;
    }

    async embedQuery(text) {
        const model = await this._getModel();
        const output = await model(text, { pooling: 'mean', normalize: true });
        const embedding = Array.from(output.data);
        return normalize(embedding);
    }
}

const worker = new Worker(
    'file-upload-queue',
    async (job) => {
        const startTime = Date.now();
        console.log(`[${new Date().toISOString()}] Job received:`, job.data)
        
        // Parse the JSON string that was sent from index.js
        const data = typeof job.data === 'string' ? JSON.parse(job.data) : job.data

        // Ensure the path is absolute
        const filePath = path.isAbsolute(data.path) ? data.path : path.resolve(__dirname, data.path)
        console.log(`[${new Date().toISOString()}] Loading file from: ${filePath}`)
        
        // Load PDF
        const loadStart = Date.now();
        const loader = new UnstructuredLoader(filePath, {
            apiUrl: "http://localhost:5000/general/v0/general"
        })
        const docs = await loader.load()
        console.log(`[${new Date().toISOString()}] PDF loaded in ${((Date.now() - loadStart) / 1000).toFixed(2)}s - ${docs.length} pages`)

        // Inspect and log sample text quality
        if (docs.length > 0) {
            const sampleText = docs[0].pageContent?.slice(0, 300) || '';
            console.log(`[${new Date().toISOString()}] Sample text (first 300 chars):`, sampleText);
            console.log(`[${new Date().toISOString()}] Text quality check - Has content: ${sampleText.length > 0}, Has letters: ${/[a-zA-Z]/.test(sampleText)}`);
        }

        // Clean documents
        const cleanStart = Date.now();
        const cleanedDocs = docs.map(doc => ({
            ...doc,
            pageContent: cleanText(doc.pageContent)
        })).filter(doc => doc.pageContent.length > 50); // Remove empty/tiny pages
        
        console.log(`[${new Date().toISOString()}] Cleaned ${docs.length} -> ${cleanedDocs.length} docs in ${((Date.now() - cleanStart) / 1000).toFixed(2)}s`)

        // Split documents with better settings for complete sections
        const splitStart = Date.now();
        const splitter = new RecursiveCharacterTextSplitter({
            chunkSize: 800,        // Larger chunks to keep complete sections together
            chunkOverlap: 200,     // More overlap to capture section headers and context
            separators: ['\n\n', '\n', '. ', ' ', ''], // Better sentence/paragraph boundaries
            keepSeparator: true,   // Keep separators for better context
        })
        const allTexts = await splitter.splitDocuments(cleanedDocs);
        
        // Filter out invalid/low-quality chunks
        const validTexts = allTexts.filter(doc => isValidChunk(doc.pageContent));
        
        // Enrich chunks with section headers and metadata
        const texts = validTexts.map((doc, idx) => enrichChunk(doc, idx, validTexts));
        
        console.log(`[${new Date().toISOString()}] Documents split in ${((Date.now() - splitStart) / 1000).toFixed(2)}s - ${allTexts.length} -> ${texts.length} valid chunks`)

        if (texts.length === 0) {
            throw new Error('No valid text chunks after processing. Check document quality.');
        }

        // Log sample chunks for quality check
        console.log(`[${new Date().toISOString()}] Sample chunk 1:`, texts[0]?.pageContent?.slice(0, 150));
        if (texts.length > 1) {
            console.log(`[${new Date().toISOString()}] Sample chunk 2:`, texts[Math.floor(texts.length / 2)]?.pageContent?.slice(0, 150));
        }

        // Initialize embeddings (this will download model on first run)
        const embedInitStart = Date.now();
        console.log(`[${new Date().toISOString()}] Initializing embeddings model...`)
        const embeddings = new LocalEmbeddings();
        
        // Pre-load the model to show progress
        await embeddings._getModel();
        console.log(`[${new Date().toISOString()}] Embeddings model ready in ${((Date.now() - embedInitStart) / 1000).toFixed(2)}s`)

        // Validate embedding quality with test samples
        const testStart = Date.now();
        const testEmbeddings = await embeddings.embedDocuments([
            "This is a test sentence about machine learning.",
            "This is a test sentence about machine learning.",  // duplicate
            "The weather is sunny today."  // different topic
        ]);
        
        const similarity1_2 = cosineSimilarity(testEmbeddings[0], testEmbeddings[1]);
        const similarity1_3 = cosineSimilarity(testEmbeddings[0], testEmbeddings[2]);
        
        console.log(`[${new Date().toISOString()}] Embedding validation:`);
        console.log(`  - Dimension: ${testEmbeddings[0].length}`);
        console.log(`  - Identical texts similarity: ${similarity1_2.toFixed(4)} (should be ~1.0)`);
        console.log(`  - Different texts similarity: ${similarity1_3.toFixed(4)} (should be <0.7)`);
        console.log(`  - Sample values: [${testEmbeddings[0].slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);
        
        if (similarity1_2 < 0.95) {
            console.warn(`[${new Date().toISOString()}] ⚠️ Warning: Identical embeddings have low similarity. Model may have issues.`);
        }

        // Connect to vector store
        const vectorStore = await QdrantVectorStore.fromExistingCollection(
            embeddings,
            {
                url: 'http://localhost:6333',
                collectionName: 'air-university2',
            }
        );

        // Add documents with progress tracking
        const addStart = Date.now();
        console.log(`[${new Date().toISOString()}] Adding ${texts.length} documents to vector store...`)
        
        // Deduplicate chunks before adding
        const dedupeStart = Date.now();
        const uniqueTexts = [];
        const seenHashes = new Set();
        
        for (const doc of texts) {
            // Simple hash-based deduplication
            const content = doc.pageContent.toLowerCase().replace(/\s+/g, ' ').trim();
            const hash = content.slice(0, 200); // Use first 200 chars as signature
            
            if (!seenHashes.has(hash)) {
                seenHashes.add(hash);
                uniqueTexts.push(doc);
            }
        }
        
        console.log(`[${new Date().toISOString()}] Deduplicated ${texts.length} -> ${uniqueTexts.length} chunks in ${((Date.now() - dedupeStart) / 1000).toFixed(2)}s`)
        
        // Process in batches to show progress
        const batchSize = 10;
        let addedCount = 0;
        
        for (let i = 0; i < uniqueTexts.length; i += batchSize) {
            const batch = uniqueTexts.slice(i, i + batchSize);
            
            try {
                await vectorStore.addDocuments(batch);
                addedCount += batch.length;
                const progress = ((addedCount) / uniqueTexts.length * 100).toFixed(1);
                console.log(`[${new Date().toISOString()}] Progress: ${progress}% (${addedCount}/${uniqueTexts.length} chunks)`)
            } catch (error) {
                console.error(`[${new Date().toISOString()}] Error adding batch ${i}-${i + batch.length}:`, error.message);
                // Continue with next batch
            }
        }
        
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[${new Date().toISOString()}] ✅ Successfully added ${addedCount}/${uniqueTexts.length} docs to vector store in ${totalTime}s`)
        
        // Quality metrics summary
        console.log(`[${new Date().toISOString()}] === QUALITY SUMMARY ===`);
        console.log(`  Original pages: ${docs.length}`);
        console.log(`  After cleaning: ${cleanedDocs.length}`);
        console.log(`  Total chunks: ${allTexts.length}`);
        console.log(`  Valid chunks: ${texts.length}`);
        console.log(`  Unique chunks: ${uniqueTexts.length}`);
        console.log(`  Added to DB: ${addedCount}`);
        console.log(`  Deduplication rate: ${((1 - uniqueTexts.length / texts.length) * 100).toFixed(1)}%`);

    },
    {
        concurrency: 100,
        connection: {
            host: 'localhost',
            port: '6379'
        }
    }
)
