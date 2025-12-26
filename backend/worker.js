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
        const loader = new UnstructuredLoader(filePath)
        const docs = await loader.load()
        console.log(`[${new Date().toISOString()}] PDF loaded in ${((Date.now() - loadStart) / 1000).toFixed(2)}s - ${docs.length} pages`)

        // Split documents
        const splitStart = Date.now();
        const splitter = new RecursiveCharacterTextSplitter({chunkSize:300, chunkOverlap:0})
        const texts = await splitter.splitDocuments(docs);
        console.log(`[${new Date().toISOString()}] Documents split in ${((Date.now() - splitStart) / 1000).toFixed(2)}s - ${texts.length} chunks`)

        // Initialize embeddings (this will download model on first run)
        const embedInitStart = Date.now();
        console.log(`[${new Date().toISOString()}] Initializing embeddings model...`)
        const embeddings = new LocalEmbeddings();
        
        // Pre-load the model to show progress
        await embeddings._getModel();
        console.log(`[${new Date().toISOString()}] Embeddings model ready in ${((Date.now() - embedInitStart) / 1000).toFixed(2)}s`)

        // Connect to vector store
        const vectorStore = await QdrantVectorStore.fromExistingCollection(
            embeddings,
            {
                url: 'http://localhost:6333',
                collectionName: 'langchainjs-testing',
            }
        );

        // Add documents with progress tracking
        const addStart = Date.now();
        console.log(`[${new Date().toISOString()}] Adding ${texts.length} documents to vector store...`)
        
        // Process in batches to show progress
        const batchSize = 10;
        for (let i = 0; i < texts.length; i += batchSize) {
            const batch = texts.slice(i, i + batchSize);
            await vectorStore.addDocuments(batch);
            const progress = ((i + batch.length) / texts.length * 100).toFixed(1);
            console.log(`[${new Date().toISOString()}] Progress: ${progress}% (${i + batch.length}/${texts.length} chunks)`)
        }
        
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[${new Date().toISOString()}] ✅ All ${texts.length} docs added to vector store in ${totalTime}s`)

    },
    {
        concurrency: 100,
        connection: {
            host: 'localhost',
            port: '6379'
        }
    }
)
