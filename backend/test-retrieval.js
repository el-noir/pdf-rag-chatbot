import { QdrantVectorStore } from "@langchain/qdrant";
import { pipeline } from '@xenova/transformers';
import { Embeddings } from "@langchain/core/embeddings";
import { enhancedRetrieval } from './query-enhancer.js';

// Same embedding class from worker.js
class LocalEmbeddings extends Embeddings {
    constructor() {
        super();
        this.model = null;
    }

    async _getModel() {
        if (!this.model) {
            this.model = await pipeline(
                'feature-extraction',
                'Xenova/all-MiniLM-L6-v2'
            );
        }
        return this.model;
    }

    async embedDocuments(texts) {
        const model = await this._getModel();
        const textStrings = texts.map(text => 
            typeof text === 'string' ? text : text.pageContent || text.content || String(text)
        );
        const embeddings = await Promise.all(
            textStrings.map(async (text) => {
                const output = await model(text, { pooling: 'mean', normalize: true });
                const embedding = Array.from(output.data);
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
        const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
        return magnitude > 0 ? embedding.map(v => v / magnitude) : embedding;
    }
}

async function testRetrieval() {
    console.log('Initializing embeddings model...');
    const embeddings = new LocalEmbeddings();
    await embeddings._getModel();
    console.log('✓ Model ready\n');

    console.log('Connecting to Qdrant...');
    const vectorStore = await QdrantVectorStore.fromExistingCollection(
        embeddings,
        {
            url: 'http://localhost:6333',
            collectionName: 'air-university2',
        }
    );
    console.log('✓ Connected\n');

    // Test queries - Air University specific
    const testQueries = [
        "Tell me about the dress code of Air University",
        "What is the fee structure of CS department?",
        "What are the admission requirements?",
        "What programs are offered at Air university?",
        "Tell me about faculty at Air University",
    ];

    console.log('=== RETRIEVAL QUALITY TEST ===\n');

    for (const query of testQueries) {
        console.log(`\n${'='.repeat(80)}`);
        console.log(`Query: "${query}"`);
        console.log('='.repeat(80));
        
        try {
            // Use enhanced retrieval
            const { results, formatted, stats } = await enhancedRetrieval(
                vectorStore, 
                query,
                {
                    topK: 10,
                    finalK: 3,
                    useEnhancement: true,
                    useReranking: true,
                    deduplicate: true,
                }
            );
            
            if (results.length === 0) {
                console.log('⚠️  No results found!\n');
                continue;
            }

            console.log(`\nStats: Retrieved ${stats.retrieved} → Dedup ${stats.afterDedup} → Final ${stats.final}\n`);

            results.forEach(([doc, score], i) => {
                console.log(`\n${'─'.repeat(80)}`);
                console.log(`Result ${i + 1}: Score ${score.toFixed(4)} (${score > 0.7 ? '✓ Good' : score > 0.5 ? '~ OK' : '✗ Poor'})`);
                
                if (doc.metadata?.section) {
                    console.log(`Section: ${doc.metadata.section}`);
                }
                
                // Show full content for better assessment
                const content = doc.pageContent;
                console.log(`\nContent:\n${content}\n`);
            });
            
            console.log(`\n${'='.repeat(80)}`);
            console.log('FORMATTED FOR LLM:');
            console.log('='.repeat(80));
            console.log(formatted);
            console.log('='.repeat(80) + '\n');
            
        } catch (error) {
            console.error(`Error: ${error.message}\n`);
        }
    }

    console.log('=== EVALUATION TIPS ===');
    console.log('Good retrieval:');
    console.log('  - Scores > 0.7 for relevant content');
    console.log('  - Top results are semantically related to query');
    console.log('  - Different queries return different results');
    console.log('\nPoor retrieval:');
    console.log('  - All scores < 0.5');
    console.log('  - Same results for different queries');
    console.log('  - Results are not semantically related\n');
}

testRetrieval().catch(console.error);
