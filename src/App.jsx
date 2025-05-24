import React, { useState } from 'react';
import { Upload, Link, Play, FileText, Copy, Loader2, CheckCircle, AlertCircle, Languages, Type } from 'lucide-react';

const VideoTranscriptionApp = () => {
  const [activeTab, setActiveTab] = useState('upload');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcription, setTranscription] = useState('');
  const [processedTranscription, setProcessedTranscription] = useState('');
  const [status, setStatus] = useState('idle');
  const [isCopied, setIsCopied] = useState(false);
  const [error, setError] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [isFormatting, setIsFormatting] = useState(false);

  // Função para processar o texto (traduzir/formatar)
  const processText = async (text, shouldTranslate, shouldFormat) => {
    try {
      setIsTranslating(shouldTranslate);
      setIsFormatting(shouldFormat);

      const response = await fetch('/api/process-text', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          text,
          shouldTranslate,
          shouldFormat
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao processar texto');
      }

      setProcessedTranscription(data.processedText);
      setStatus('completed');
    } catch (error) {
      console.error('Erro:', error);
      setError(error.message);
      setStatus('error');
    } finally {
      setIsTranslating(false);
      setIsFormatting(false);
    }
  };

  // ... existing code ...

  // Modificar a função copyTranscription
  const copyTranscription = async () => {
    const textToCopy = processedTranscription || transcription;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      const textArea = document.createElement('textarea');
      textArea.value = textToCopy;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  // Modificar a função resetApp
  const resetApp = () => {
    setYoutubeUrl('');
    setInstagramUrl('');
    setUploadedFile(null);
    setTranscription('');
    setProcessedTranscription('');
    setStatus('idle');
    setIsProcessing(false);
    setIsCopied(false);
    setError('');
    setIsTranslating(false);
    setIsFormatting(false);
  };

  // ... existing code ...

  {/* Modificar a seção Transcription Result */}
  {transcription && (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-gray-700 flex items-center">
          <FileText className="w-5 h-5 mr-2" />
          Transcrição
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => processText(transcription, true, false)}
            disabled={isTranslating || isFormatting}
            className={`px-4 py-2 rounded-lg transition-colors flex items-center ${
              isTranslating 
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-blue-500 text-white hover:bg-blue-600'
            }`}
          >
            {isTranslating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Traduzindo...
              </>
            ) : (
              <>
                <Languages className="w-4 h-4 mr-2" />
                Traduzir
              </>
            )}
          </button>
          <button
            onClick={() => processText(transcription, false, true)}
            disabled={isTranslating || isFormatting}
            className={`px-4 py-2 rounded-lg transition-colors flex items-center ${
              isFormatting 
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-purple-500 text-white hover:bg-purple-600'
            }`}
          >
            {isFormatting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Formatando...
              </>
            ) : (
              <>
                <Type className="w-4 h-4 mr-2" />
                Formatar
              </>
            )}
          </button>
          <button
            onClick={copyTranscription}
            className={`px-4 py-2 rounded-lg transition-colors flex items-center ${
              isCopied 
                ? 'bg-green-500 text-white' 
                : 'bg-gray-500 text-white hover:bg-gray-600'
            }`}
          >
            {isCopied ? (
              <>
                <CheckCircle className="w-4 h-4 mr-2" />
                Copiado!
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 mr-2" />
                Copiar
              </>
            )}
          </button>
          <button
            onClick={resetApp}
            className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition-colors"
          >
            Novo Vídeo
          </button>
        </div>
      </div>
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
        <pre className="whitespace-pre-wrap text-gray-700 text-sm font-sans">
          {processedTranscription || transcription}
        </pre>
      </div>
    </div>
  )}

  // ... rest of the existing code ...
