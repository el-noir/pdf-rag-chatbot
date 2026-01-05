# Reprocessing Documents with Improved Settings

## Issue
The current chunks in Qdrant are too small (from old 400-char setting), causing fragmented results like:
```
"l Dress code (students): Separate guidance for boys and girls; improperly dressed stud..."
```

The full dress code details are split across chunks and not retrieved together.

## Solution
Reprocess documents with the NEW settings (800-char chunks with header enrichment).

## Steps to Reprocess

### Option 1: Clear and Reupload (Recommended)

1. **Clear existing collection:**
```bash
npm run setup:qdrant:recreate
```
⚠️ This deletes all existing data!

2. **Start the worker:**
```bash
npm run dev:worker
```

3. **Re-upload your PDF files** through the frontend or API:
```bash
# Using curl (example)
curl -X POST http://localhost:8000/upload/pdf \
  -F "pdf=@/path/to/your/document.pdf"
```

4. **Test retrieval quality:**
```bash
npm run test:retrieval
```

### Option 2: Add to Existing Collection (Incremental)

If you want to keep existing data and just add newly processed versions:

1. **Start worker** (don't recreate collection)
2. **Upload PDF files** - they'll be added with new chunking
3. **Old chunks remain** but new ones will be better

⚠️ This creates duplicates with different chunk sizes.

## Expected Results After Reprocessing

### Before (Old 400-char chunks):
```
Query: "Tell me about dress code"
Results:
1. "l Dress code (students): Separate guidance for boys and girls..."
2. "modest and professional/decent manner..."
3. "unduly revealing outfits prohibited..."
```
❌ Fragmented, incomplete information

### After (New 800-char chunks with headers):
```
Query: "Tell me about dress code"
Results:
1. "DRESS CODE

   Students are required to follow Air University dress code:
   
   For Male Students:
   - Wear formal shirts and trousers
   - [complete rules here]
   
   For Female Students:
   - Wear modest attire
   - [complete rules here]
   
   Improperly dressed students may face disciplinary action..."
```
✅ Complete, structured information

## What Changed in Worker.js

1. **Chunk Size**: 400 → 800 characters
2. **Chunk Overlap**: 100 → 200 characters
3. **Header Detection**: Automatically finds and prepends section titles
4. **Metadata Enrichment**: Adds section headers to metadata
5. **Better Validation**: Minimum 50 chars, 8 words

## Verifying Success

After reprocessing, run the test:
```bash
npm run test:retrieval
```

Good indicators:
- Longer chunks (400-800 chars vs 100-200)
- Section headers visible in content
- Higher relevance scores (> 0.7) for relevant queries
- Complete information in single chunks

## Testing with Real Queries

Start the backend and test through your chat interface:
```bash
npm run start
```

Test queries:
- "Tell me about the dress code of Air University"
- "What is the fee structure?"
- "What are admission requirements?"

The LLM should now receive complete, structured information and provide detailed answers.

## Rollback

If new settings cause issues:

1. Change back in [worker.js](worker.js):
```javascript
chunkSize: 400,
chunkOverlap: 100,
```

2. Recreate collection and reprocess

## Monitoring

Watch console output during processing:
```
[timestamp] Documents split: 150 -> 120 valid chunks
[timestamp] Sample chunk 1: DRESS CODE...
```

Check that:
- Sample chunks show complete sentences
- Headers are visible
- Chunks are 400-800 chars (not 50-200)
