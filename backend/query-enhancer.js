/**
 * Query Enhancement Utilities for Better Retrieval
 * 
 * These functions help improve retrieval quality by:
 * 1. Expanding queries with synonyms
 * 2. Retrieving more results and reranking
 * 3. Combining multiple search strategies
 */

// Enhance query with relevant synonyms and variations
export function enhanceQuery(query) {
    const enhancements = {
        'dress code': ['dress code', 'clothing', 'uniform', 'attire', 'dress policy', 'what to wear'],
        'fee structure': ['fee structure', 'tuition', 'cost', 'fees', 'charges', 'payment'],
        'admission': ['admission', 'entry', 'enrollment', 'apply', 'requirements', 'eligibility'],
        'programs': ['programs', 'courses', 'degrees', 'majors', 'departments', 'disciplines'],
        'faculty': ['faculty', 'professors', 'teachers', 'instructors', 'staff'],
    };

    let enhanced = query.toLowerCase();
    
    // Find matching enhancement
    for (const [key, synonyms] of Object.entries(enhancements)) {
        if (enhanced.includes(key)) {
            // Add key variations to query context (for better embedding)
            return query + ' ' + synonyms.slice(0, 3).join(' ');
        }
    }
    
    return query;
}

// Rerank results by combining similarity score with content quality
export function rerankResults(results, query) {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 3);
    
    return results.map(([doc, score]) => {
        let qualityScore = score;
        const content = doc.pageContent.toLowerCase();
        
        // Boost if query words appear in content
        const wordMatches = queryWords.filter(word => content.includes(word)).length;
        const wordBoost = (wordMatches / queryWords.length) * 0.1;
        
        // Boost longer, more complete chunks
        const lengthBoost = Math.min(doc.pageContent.length / 1000, 0.05);
        
        // Boost if has section metadata
        const metadataBoost = doc.metadata?.section ? 0.05 : 0;
        
        qualityScore += wordBoost + lengthBoost + metadataBoost;
        
        return [doc, score, qualityScore];
    }).sort((a, b) => b[2] - a[2]); // Sort by quality score
}

// Deduplicate results (remove chunks with similar content)
export function deduplicateResults(results, threshold = 0.85) {
    const unique = [];
    const seen = new Set();
    
    for (const [doc, score] of results) {
        // Create a signature from the first 200 chars
        const signature = doc.pageContent
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .slice(0, 200);
        
        // Check if we've seen similar content
        let isDuplicate = false;
        for (const seenSig of seen) {
            if (similarity(signature, seenSig) > threshold) {
                isDuplicate = true;
                break;
            }
        }
        
        if (!isDuplicate) {
            unique.push([doc, score]);
            seen.add(signature);
        }
    }
    
    return unique;
}

// Simple string similarity (Jaccard)
function similarity(str1, str2) {
    const set1 = new Set(str1.split(/\s+/));
    const set2 = new Set(str2.split(/\s+/));
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
}

// Format results for LLM consumption
export function formatResultsForLLM(results, maxChunks = 5) {
    return results.slice(0, maxChunks).map(([doc, score], i) => {
        let formatted = `[Document ${i + 1}] (Relevance: ${(score * 100).toFixed(1)}%)\n`;
        
        if (doc.metadata?.section) {
            formatted += `Section: ${doc.metadata.section}\n`;
        }
        
        formatted += `Content: ${doc.pageContent}\n`;
        
        return formatted;
    }).join('\n---\n\n');
}

// Main retrieval pipeline with enhancements
export async function enhancedRetrieval(vectorStore, query, options = {}) {
    const {
        topK = 10,              // Retrieve more initially
        finalK = 5,             // Return top N after reranking
        useEnhancement = true,  // Use query enhancement
        useReranking = true,    // Use reranking
        deduplicate = true,     // Remove duplicates
    } = options;
    
    // Step 1: Enhance query
    const enhancedQuery = useEnhancement ? enhanceQuery(query) : query;
    console.log(`Original query: "${query}"`);
    if (enhancedQuery !== query) {
        console.log(`Enhanced query: "${enhancedQuery}"`);
    }
    
    // Step 2: Retrieve more results
    const results = await vectorStore.similaritySearchWithScore(enhancedQuery, topK);
    
    if (results.length === 0) {
        return { results: [], formatted: 'No relevant information found.' };
    }
    
    // Step 3: Deduplicate
    let processed = deduplicate ? deduplicateResults(results) : results;
    
    // Step 4: Rerank
    if (useReranking) {
        processed = rerankResults(processed, query);
        // Convert back to [doc, score] format
        processed = processed.map(([doc, originalScore, qualityScore]) => [doc, qualityScore]);
    }
    
    // Step 5: Take top results
    const finalResults = processed.slice(0, finalK);
    
    // Step 6: Format for LLM
    const formatted = formatResultsForLLM(finalResults, finalK);
    
    return {
        results: finalResults,
        formatted,
        stats: {
            retrieved: results.length,
            afterDedup: deduplicate ? processed.length : results.length,
            final: finalResults.length,
        }
    };
}
