import { QdrantClient } from '@qdrant/js-client-rest';

const client = new QdrantClient({ url: 'http://localhost:6333' });
const collectionName = 'air-university2';

async function setupQdrantCollection() {
    try {
        console.log('Checking Qdrant collection...');
        
        // Check if collection exists
        const collections = await client.getCollections();
        const exists = collections.collections.some(c => c.name === collectionName);
        
        if (exists) {
            console.log(`✓ Collection '${collectionName}' already exists`);
            
            // Get collection info
            const info = await client.getCollection(collectionName);
            console.log('Collection config:', JSON.stringify(info.config, null, 2));
            
            const vectorSize = info.config.params.vectors.size;
            const distance = info.config.params.vectors.distance;
            
            console.log(`\nCurrent settings:`);
            console.log(`  - Vector size: ${vectorSize}`);
            console.log(`  - Distance metric: ${distance}`);
            
            // Check if settings are correct
            if (vectorSize !== 384) {
                console.warn(`\n⚠️  WARNING: Vector size is ${vectorSize}, but Xenova/all-MiniLM-L6-v2 produces 384-dimensional vectors.`);
                console.warn(`   You should recreate the collection with correct vector size.`);
                console.warn(`   Run: node setup-qdrant.js --recreate`);
            }
            
            if (distance !== 'Cosine') {
                console.warn(`\n⚠️  WARNING: Distance metric is ${distance}. Cosine is recommended for normalized embeddings.`);
            }
            
            if (vectorSize === 384 && distance === 'Cosine') {
                console.log('\n✅ Collection is properly configured!');
            }
        } else {
            console.log(`Collection '${collectionName}' does not exist. Creating...`);
            await createCollection();
        }
        
    } catch (error) {
        console.error('Error:', error.message);
    }
}

async function createCollection() {
    try {
        await client.createCollection(collectionName, {
            vectors: {
                size: 384,  // Xenova/all-MiniLM-L6-v2 dimension
                distance: 'Cosine',  // Best for normalized embeddings
            },
            optimizers_config: {
                indexing_threshold: 10000,  // Build index after 10k vectors
            },
            hnsw_config: {
                m: 16,  // Number of edges per node (default is good)
                ef_construct: 100,  // Higher = better quality but slower indexing
            }
        });
        
        console.log(`✅ Collection '${collectionName}' created successfully!`);
        console.log('Settings:');
        console.log('  - Vector size: 384');
        console.log('  - Distance: Cosine');
        console.log('  - Optimized for semantic search');
    } catch (error) {
        console.error('Error creating collection:', error.message);
    }
}

async function recreateCollection() {
    try {
        console.log(`Deleting collection '${collectionName}'...`);
        await client.deleteCollection(collectionName);
        console.log('✓ Collection deleted');
        
        console.log('Creating new collection with correct settings...');
        await createCollection();
    } catch (error) {
        console.error('Error recreating collection:', error.message);
    }
}

// Main execution
const args = process.argv.slice(2);

if (args.includes('--recreate')) {
    console.log('⚠️  RECREATING COLLECTION - All existing data will be lost!');
    recreateCollection();
} else {
    setupQdrantCollection();
}
