'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import * as React from 'react';

interface Doc {
  pageContent?: string;
  metadata?: {
    loc?: {
      pageNumber?: number;
    };
    source?: string;
  };
}
interface IMessage {
  role: 'assistant' | 'user';
  content?: string;
  documents?: Doc[];
}

const ChatComponent: React.FC = () => {
  const [message, setMessage] = React.useState<string>('');
  const [messages, setMessages] = React.useState<IMessage[]>([]);
  const [loading, setLoading] = React.useState<boolean>(false);
  const [expandedDocs, setExpandedDocs] = React.useState<Set<number>>(new Set());
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  React.useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const toggleDocExpansion = (index: number) => {
    setExpandedDocs((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  // Render assistant content into headings, paragraphs, and bullet lists
  const renderAssistantContent = (content?: string) => {
    if (!content) return null;
    const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const elements: React.ReactNode[] = [];

    let currentList: string[] | null = null;

    const flushList = () => {
      if (currentList) {
        elements.push(
          <ul key={elements.length} className="list-disc pl-6 space-y-1 text-sm text-gray-800">
            {currentList.map((li, i) => (
              <li key={i}>{li}</li>
            ))}
          </ul>
        );
        currentList = null;
      }
    };

    for (const line of lines) {
      // bullet-like lines
      if (/^([-\u2022\*]|•)\s+/.test(line) || /^\d+\./.test(line)) {
        const cleaned = line.replace(/^([-\u2022\*\d+.]+)\s*/, '');
        currentList = currentList ?? [];
        currentList.push(cleaned);
        continue;
      }

      // If we hit a normal line but had a list accumulating, flush it
      if (currentList) flushList();

      // Headings: lines that are bold-marked or end with ':' or are short all-caps
      if (/^\*\*(.+)\*\*$/.test(line)) {
        const m = line.match(/^\*\*(.+)\*\*$/);
        elements.push(<div key={elements.length} className="font-semibold text-gray-900">{m?.[1]}</div>);
        continue;
      }

      if (line.endsWith(':') || (line.length < 60 && line === line.toUpperCase())) {
        elements.push(<div key={elements.length} className="font-semibold text-gray-900">{line.replace(/:$/, '')}</div>);
        continue;
      }

      // Otherwise paragraph
      elements.push(<p key={elements.length} className="text-sm text-gray-800">{line}</p>);
    }

    flushList();
    return <div className="space-y-2">{elements}</div>;
  };

  const handleSendChatMessage = async () => {
    if (!message.trim() || loading) return;

    const userMessage = message;
    setMessage('');
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);

    try {
      const res = await fetch(`http://localhost:8000/chat?message=${encodeURIComponent(userMessage)}`);
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data?.message,
          documents: data?.docs,
        },
      ]);
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Sorry, I encountered an error. Please try again.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendChatMessage();
    }
  };

  return (
    <div className="flex flex-col h-screen">
      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <p className="text-lg mb-2">Welcome to the AI Chatbot</p>
              <p className="text-sm">Ask questions about your uploaded documents</p>
            </div>
          </div>
        )}
        
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg p-4 ${
                msg.role === 'user'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-900'
              }`}
            >
              {msg.role === 'user' ? (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              ) : (
                <div>
                  {/* Render assistant content in a UI-friendly way */}
                  <div className="prose max-w-none">
                    {renderAssistantContent(msg.content)}
                  </div>

                  {msg.documents && msg.documents.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-300">
                      <button
                        onClick={() => toggleDocExpansion(index)}
                        className="text-sm text-blue-600 hover:text-blue-800 mb-2"
                      >
                        {expandedDocs.has(index) ? '▼ Hide sources' : `▶ Show sources (${msg.documents.length})`}
                      </button>

                      {expandedDocs.has(index) && (
                        <div className="space-y-2 mt-2">
                          {msg.documents.map((doc, docIndex) => (
                            <div
                              key={docIndex}
                              className="bg-white rounded p-3 text-sm border border-gray-200"
                            >
                              <div className="flex items-center justify-between mb-1">
                                <div className="font-semibold text-gray-800">Source {docIndex + 1}</div>
                                {doc.metadata?.loc?.pageNumber && (
                                  <div className="text-gray-500 text-xs">Page {doc.metadata.loc.pageNumber}</div>
                                )}
                              </div>
                              <div className="text-gray-700 max-h-36 overflow-y-auto text-sm">
                                {doc.pageContent?.length > 400 ? doc.pageContent.slice(0, 400) + '...' : doc.pageContent}
                              </div>
                              {doc.metadata?.source && (
                                <div className="mt-2 text-xs text-gray-500">Source: {doc.metadata.source}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-lg p-4">
              <div className="flex space-x-2">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input Container */}
      <div className="border-t p-4 bg-white">
        <div className="flex gap-3">
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type your message here..."
            disabled={loading}
            className="flex-1"
          />
          <Button 
            onClick={handleSendChatMessage} 
            disabled={!message.trim() || loading}
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ChatComponent;