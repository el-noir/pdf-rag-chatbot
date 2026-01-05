# Embedding Quality Improvements

## Overview
This document explains the improvements made to the document processing and embedding pipeline to achieve better semantic search quality.

## Issues Addressed

### 1. **Poor Text Extraction Quality**
- **Problem**: UnstructuredLoader may extract noisy text with headers, footers, and formatting artifacts
- **Solution**: Implemented `cleanText()` function that:
  - Removes control characters and PDF artifacts
  - Detects and removes repeated headers/footers
  - Normalizes whitespace
  - Filters out empty/tiny pages (< 50 chars)

### 2. **Suboptimal Chunking Strategy**
- **Problem**: Original chunks (600 chars, 200 overlap) were too large, reducing semantic precision
- **Solution**: 
  - Reduced chunk size to **400 characters** for better granularity
  - Reduced overlap to **100 characters** to balance context and uniqueness
  - Added intelligent separators: `['\n\n', '\n', '. ', ' ', '']` to respect sentence/paragraph boundaries
  - Filter chunks that are too short (< 30 chars) or have < 5 words

### 3. **Embedding Normalization**
- **Problem**: Embeddings may not be properly L2-normalized, affecting cosine similarity
- **Solution**: 
  - Added explicit `normalize()` function
  - Apply L2 normalization to all embeddings before storage
  - Ensures consistent magnitude for accurate cosine similarity

### 4. **Duplicate Content**
- **Problem**: PDFs often contain repeated content, wasting storage and reducing search quality
- **Solution**: 
  - Implemented hash-based deduplication using first 200 chars as signature
  - Typically reduces chunks by 10-30%
  - Logs deduplication rate for monitoring

### 5. **No Quality Validation**
- **Problem**: No way to verify if embeddings are working correctly
- **Solution**: 
  - Added embedding quality tests (identical vs. different text similarity)
  - Sample chunk logging for manual inspection
  - Comprehensive quality metrics summary

### 6. **Qdrant Configuration**
- **Problem**: Collection may have wrong vector size or distance metric
- **Solution**: Created `setup-qdrant.js` to:
  - Verify collection configuration
  - Check vector dimension matches model (384 for all-MiniLM-L6-v2)
  - Ensure Cosine distance is used
  - Recreate collection with correct settings if needed

## Files Modified

### `worker.js`
Enhanced with:
- Text cleaning and preprocessing utilities
- Vector normalization and cosine similarity functions
- Chunk validation (length, word count, letter content)
- Embedding quality validation
- Deduplication logic
- Comprehensive logging and metrics

### New Files

#### `setup-qdrant.js`
Utility to check and configure Qdrant collection:
```bash
# Check collection configuration
npm run setup:qdrant

# Recreate collection with correct settings (deletes existing data)
npm run setup:qdrant:recreate
```

#### `test-retrieval.js`
Test script to evaluate retrieval quality:
```bash
npm run test:retrieval
```

Runs test queries and shows:
- Similarity scores
- Top retrieved chunks
- Quality assessment (Good/OK/Poor based on scores)

## Usage

### Step 1: Install New Dependencies
```bash
cd backend
npm install
```

### Step 2: Check Qdrant Configuration
```bash
npm run setup:qdrant
```

If it shows warnings about vector size or distance metric:
```bash
npm run setup:qdrant:recreate
```
⚠️ **Warning**: This deletes all existing data!

### Step 3: Process Documents
Start the worker as usual:
```bash
npm run dev:worker
```

Watch the console output for:
- Sample text quality check
- Chunk statistics (before/after filtering)
- Embedding validation results
- Deduplication rate
- Quality summary

### Step 4: Test Retrieval Quality
After processing documents:
```bash
npm run test:retrieval
```

Edit the test queries in `test-retrieval.js` to match your document content.

## Quality Metrics Interpretation

### Good Quality Indicators
- ✅ Identical text similarity > 0.95
- ✅ Different text similarity < 0.7
- ✅ Deduplication rate 10-30%
- ✅ Valid chunks > 80% of total chunks
- ✅ Retrieval scores > 0.7 for relevant queries

### Poor Quality Indicators
- ❌ Identical text similarity < 0.9 (embedding issue)
- ❌ All retrieval scores < 0.5 (model or data issue)
- ❌ Same results for different queries (insufficient diversity)
- ❌ Valid chunks < 50% (text extraction issues)

## Advanced Tuning

### Adjust Chunk Size
In `worker.js`, line ~130:
```javascript
const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 400,        // Try 300-500
    chunkOverlap: 100,     // Try 50-150
    separators: ['\n\n', '\n', '. ', ' ', ''],
})
```

### Change Embedding Model
To use a larger/better model, in `LocalEmbeddings` class:
```javascript
this.model = await pipeline(
    'feature-extraction',
    'Xenova/all-mpnet-base-v2'  // 768 dims, higher quality
);
```
⚠️ **Important**: Update Qdrant collection vector size to match!

### Stricter Chunk Filtering
In `worker.js`, `isValidChunk()` function:
```javascript
return cleaned.length >= 50 &&  // More strict
       cleaned.split(/\s+/).length >= 10 && 
       /[a-zA-Z]/.test(cleaned);
```

## Troubleshooting

### Issue: Low similarity scores even for relevant content
- **Check**: Run embedding validation - if identical texts < 0.95, model issue
- **Fix**: Reinstall model cache, check @xenova/transformers version

### Issue: Too many chunks filtered out
- **Check**: Console logs show sample chunks - are they actually invalid?
- **Fix**: Relax `isValidChunk()` criteria (reduce min length/words)

### Issue: Vector size mismatch error
- **Check**: Run `npm run setup:qdrant` to see current config
- **Fix**: Run `npm run setup:qdrant:recreate` to rebuild collection

### Issue: Deduplication removes too much
- **Check**: Console shows deduplication rate > 50%
- **Fix**: Increase hash length in deduplication logic (line ~165 in worker.js)

## Next Steps

If quality is still poor after these improvements:

1. **Try different loader**: Replace UnstructuredLoader with:
   - `PDFLoader` from `langchain/document_loaders/fs/pdf` (simpler)
   - `pdf-parse` directly (more control)

2. **Add OCR**: For scanned PDFs, integrate Tesseract OCR

3. **Use commercial embeddings**: OpenAI, Cohere, or HuggingFace API for higher quality

4. **Implement hybrid search**: Combine vector search with keyword/BM25 for better recall

5. **Fine-tune model**: Use domain-specific fine-tuned embedding model

## References

- [LangChain Text Splitters](https://js.langchain.com/docs/modules/data_connection/document_transformers/)
- [Qdrant Distance Metrics](https://qdrant.tech/documentation/concepts/search/#distance-metrics)
- [Sentence Transformers Models](https://www.sbert.net/docs/pretrained_models.html)
