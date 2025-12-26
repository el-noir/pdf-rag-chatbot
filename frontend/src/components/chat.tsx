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
                  <div className="whitespace-pre-wrap mb-2">{msg.content}</div>
                  
                  {msg.documents && msg.documents.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-300">
                      <button
                        onClick={() => toggleDocExpansion(index)}
                        className="text-xs text-blue-600 hover:text-blue-800 mb-2"
                      >
                        {expandedDocs.has(index) ? '▼ Hide' : '▶ Show'} sources ({msg.documents.length})
                      </button>
                      
                      {expandedDocs.has(index) && (
                        <div className="space-y-2 mt-2">
                          {msg.documents.map((doc, docIndex) => (
                            <div
                              key={docIndex}
                              className="bg-white rounded p-3 text-xs border border-gray-200"
                            >
                              <div className="font-semibold mb-1 text-gray-700">
                                Source {docIndex + 1}
                                {doc.metadata?.loc?.pageNumber && (
                                  <span className="ml-2 text-gray-500">
                                    (Page {doc.metadata.loc.pageNumber})
                                  </span>
                                )}
                              </div>
                              <div className="text-gray-600 max-h-32 overflow-y-auto">
                                {doc.pageContent}
                              </div>
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