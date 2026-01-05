# Quick Start: Enhanced RAG System

## ⚡ Immediate Action Required

Your embedding quality improvements are ready, but **you must reprocess documents** for them to take effect!

## 🚀 3-Step Quick Start

### Step 1: Clear Old Data (30 seconds)
```bash
cd backend
npm run setup:qdrant:recreate
```
⚠️ This deletes existing data. Backup if needed.

### Step 2: Start Worker (keep running)
```bash
npm run dev:worker
```
Leave this terminal open.

### Step 3: Upload Documents
In a new terminal or through your frontend, upload your PDF files again.

The worker will process them with:
- ✅ 800-char chunks (2x larger, keeps sections complete)
- ✅ Section headers automatically detected and added
- ✅ Better text cleaning and validation
- ✅ Deduplication (removes 10-30% duplicates)

Watch the console for progress and quality metrics.

## ✅ Verify Success

### Test 1: Check Retrieval
```bash
npm run test:retrieval
```

**Good signs:**
- Chunks are 400-800 characters (not 50-200)
- Scores > 0.65 for relevant queries
- Complete sentences with context

**Bad signs:**
- Still seeing fragments like "l Dress code..."
- All scores < 0.5
- → If so, documents weren't reprocessed. Redo steps 1-3.

### Test 2: Test Chat API
```bash
# Start server (new terminal)
npm run start

# Test query
curl "http://localhost:8000/chat?message=Tell%20me%20about%20the%20dress%20code%20of%20Air%20University"
```

**Expected:** Detailed, structured answer with complete dress code rules, not vague summaries.

## 📊 What Changed

| Aspect | Before | After |
|--------|--------|-------|
| Chunk Size | 400 chars | 800 chars |
| Context | No headers | Auto-detected headers |
| Retrieval | Basic k=5 | Enhanced: 15→rerank→5 |
| Query | Direct | Expanded with synonyms |
| Prompt | Generic | Specific, structured |
| Temperature | 0.7 | 0.3 (more factual) |

## 🐛 Troubleshooting

### "Still getting short answers"
- Check console logs when querying
- Look for "Retrieved: X → Final: Y" 
- If retrieved chunks are short, reprocess wasn't done

### "npm run setup:qdrant:recreate fails"
- Ensure Docker is running: `docker compose up -d`
- Check Qdrant is accessible: http://localhost:6333

### "Worker fails to process PDFs"
- Ensure Unstructured API is running (localhost:5000)
- Check PDF file is valid
- Look for error in worker console

### "Scores still low"
- Run: `npm run setup:qdrant` - verify 384 dims, Cosine
- Check that model downloaded: Should see "Model ready" in logs
- Try restarting worker (clears model cache)

## 📖 Full Documentation

- **[SUMMARY.md](SUMMARY.md)** - Complete overview of changes
- **[REPROCESS_GUIDE.md](REPROCESS_GUIDE.md)** - Detailed reprocessing steps
- **[EMBEDDING_IMPROVEMENTS.md](EMBEDDING_IMPROVEMENTS.md)** - Technical deep dive

## 🎯 Key Improvements Delivered

1. **Larger, Complete Chunks** - 800-char chunks with full context
2. **Header Enrichment** - Section titles preserved and added
3. **Query Enhancement** - Automatic synonym expansion
4. **Smart Reranking** - Combines similarity + keywords + quality
5. **Better Prompts** - Instructs LLM to be specific and complete
6. **Normalization** - Consistent L2-normalized embeddings
7. **Monitoring** - Detailed logging and test scripts

## 🔄 Regular Workflow (After Initial Setup)

1. Upload PDF → Worker processes automatically
2. Quality metrics logged to console
3. Test with: `npm run test:retrieval` (optional)
4. Query through chat API gets enhanced retrieval

## 💡 Pro Tips

- **Monitor console** during processing - shows quality metrics
- **Test with specific queries** - use your actual use cases
- **Adjust chunk size** if needed - edit worker.js line ~130
- **Use test script** regularly to catch regressions

---

**Ready?** Run the 3 steps above and your chatbot will give detailed, accurate answers! 🎉
