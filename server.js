import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { OpenAI } from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import * as play from 'play-dl';
import youtubeDl from 'youtube-dl-exec';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Configurar FFmpeg
ffmpeg.setFfmpegPath(ffmpegStatic);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('dist'));

// Configurar OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'sua-chave-aqui'
});

// Configurar Multer para upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

// =============================================
// FUNÇÕES AUXILIARES
// =============================================

// Função para converter vídeo para áudio (WAV ou MP3)
const convertVideoToAudio = (inputPath, outputPath) => {
  return new Promise((resolve, reject) => {
    const isWav = outputPath.endsWith('.wav');
    
    let command = ffmpeg(inputPath)
      .audioFrequency(16000) // Whisper funciona melhor com 16kHz
      .audioChannels(1) // Mono para reduzir tamanho
      .on('start', (commandLine) => {
        console.log('FFmpeg iniciado:', commandLine);
      })
      .on('progress', (progress) => {
        console.log(`Progresso: ${Math.round(progress.percent || 0)}%`);
      })
      .on('end', () => {
        console.log('Conversão concluída:', outputPath);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('Erro na conversão:', err);
        
        // Se falhar, tentar com WAV como fallback
        if (!isWav && outputPath.endsWith('.mp3')) {
          console.log('Tentando conversão para WAV...');
          const wavPath = outputPath.replace('.mp3', '.wav');
          convertVideoToAudio(inputPath, wavPath)
            .then(resolve)
            .catch(reject);
        } else {
          reject(err);
        }
      });

    if (isWav) {
      // WAV é mais universal e sempre funciona
      command
        .audioCodec('pcm_s16le')
        .format('wav');
    } else {
      // Tentar MP3 primeiro, com fallback para WAV
      try {
        command
          .audioCodec('libmp3lame') // Codec MP3 mais comum
          .audioBitrate('64k')
          .format('mp3');
      } catch (error) {
        console.log('MP3 não disponível, usando WAV');
        command
          .audioCodec('pcm_s16le')
          .format('wav');
      }
    }

    command.save(outputPath);
  });
};

// Função para limpar arquivos temporários
const cleanupFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('Arquivo removido:', filePath);
    }
  } catch (error) {
    console.error('Erro ao remover arquivo:', filePath, error);
  }
};

// Função simplificada para validar arquivo (sem ffprobe)
const validateMediaFile = (filePath, originalName) => {
  return new Promise((resolve, reject) => {
    // Verificar se o arquivo existe
    if (!fs.existsSync(filePath)) {
      return reject(new Error('Arquivo não encontrado'));
    }

    // Verificar tamanho do arquivo
    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
      return reject(new Error('Arquivo está vazio'));
    }

    // Verificar extensão do arquivo
    const allowedExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.mp3', '.wav', '.m4a', '.aac', '.flac'];
    const extension = path.extname(originalName).toLowerCase();
    
    if (!allowedExtensions.includes(extension)) {
      return reject(new Error(`Formato não suportado: ${extension}. Formatos aceitos: ${allowedExtensions.join(', ')}`));
    }

    console.log(`Arquivo validado: ${originalName} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
    resolve({
      size: stats.size,
      extension: extension,
      name: originalName
    });
  });
};

// Função para traduzir texto usando ChatGPT
const translateText = async (text) => {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "Você é um tradutor profissional. Traduza o texto para português do Brasil mantendo o significado e o tom original."
        },
        {
          role: "user",
          content: text
        }
      ],
      temperature: 0.3
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error('Erro na tradução:', error);
    throw new Error('Falha ao traduzir o texto: ' + error.message);
  }
};

// Função para organizar e formatar o texto
const formatText = async (text) => {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "Você é um editor profissional. Organize o texto em parágrafos lógicos, corrija erros de pontuação e formatação, e melhore a legibilidade mantendo o conteúdo original."
        },
        {
          role: "user",
          content: text
        }
      ],
      temperature: 0.3
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error('Erro na formatação:', error);
    throw new Error('Falha ao formatar o texto: ' + error.message);
  }
};

// Função para baixar áudio do YouTube usando múltiplas estratégias
const downloadYouTubeAudio = async (url, audioPath) => {
  // Primeira tentativa: usar play-dl
  try {
    console.log('Tentando download com play-dl...');
    
    const yt_info = await play.video_info(url);
    const stream = await play.stream_from_info(yt_info);
    
    await new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(audioPath);
      stream.stream.pipe(writeStream);
      
      writeStream.on('finish', () => {
        console.log('Download concluído com play-dl');
        resolve();
      });
      
      writeStream.on('error', (err) => {
        console.error('Erro no writeStream:', err);
        reject(err);
      });
    });

    // Verificar se o arquivo foi baixado corretamente
    const stats = fs.statSync(audioPath);
    if (stats.size > 0) {
      console.log(`Download concluído: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
      return;
    }
  } catch (error) {
    console.log('Falha no download com play-dl:', error.message);
  }

  // Segunda tentativa: usar youtube-dl
  try {
    console.log('Tentando download com youtube-dl...');
    
    await youtubeDl(url, {
      extractAudio: true,
      audioFormat: 'wav',
      output: audioPath,
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      addHeader: [
        'referer:youtube.com',
        'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      ]
    });

    // Verificar se o arquivo foi baixado corretamente
    const stats = fs.statSync(audioPath);
    if (stats.size > 0) {
      console.log(`Download concluído com youtube-dl: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
      return;
    }
  } catch (error) {
    console.log('Falha no download com youtube-dl:', error.message);
    throw new Error('Falha ao baixar o áudio do YouTube com todos os métodos disponíveis');
  }
};

// =============================================
// ROTAS DA API
// =============================================

// Rota para transcrever YouTube
app.post('/api/transcribe-youtube', async (req, res) => {
  let audioPath = null;
  let mp3Path = null;

  try {
    const { url, language, shouldTranslate = false, shouldFormat = false } = req.body;
    
    console.log('Iniciando processamento do YouTube:', url);
    
    if (!url || !url.trim()) {
      return res.status(400).json({ 
        error: 'URL do YouTube é obrigatória' 
      });
    }

    // Validar URL do YouTube
    if (!url.match(/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/)) {
      return res.status(400).json({ 
        error: 'URL do YouTube inválida' 
      });
    }

    // Criar diretório temporário
    const tempDir = 'temp';
    if (!fs.existsSync(tempDir)) {
      console.log('Criando diretório temporário:', tempDir);
      fs.mkdirSync(tempDir);
    }

    // Definir caminhos dos arquivos
    audioPath = path.join(tempDir, `temp_youtube_${Date.now()}.wav`);
    mp3Path = path.join(tempDir, `temp_youtube_${Date.now()}_converted.wav`);

    // Baixar o áudio
    await downloadYouTubeAudio(url, audioPath);

    // Converter para formato adequado para o Whisper
    console.log('Convertendo áudio para formato adequado...');
    await convertVideoToAudio(audioPath, mp3Path);
    console.log('Conversão concluída');

    // Verificar a chave da API
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'sua-chave-aqui') {
      throw new Error('Chave da API OpenAI não configurada');
    }

    console.log('Enviando para Whisper...');
    const transcriptionParams = {
      file: fs.createReadStream(mp3Path),
      model: "whisper-1"
    };
    
    if (language && language !== 'auto') {
      transcriptionParams.language = language;
      console.log(`Idioma forçado: ${language}`);
    }
    
    const response = await openai.audio.transcriptions.create(transcriptionParams);
    console.log('Transcrição concluída com sucesso');

    // Limpar arquivos temporários
    try {
      if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
      if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);
    } catch (cleanupError) {
      console.error('Erro ao limpar arquivos temporários:', cleanupError);
    }

    res.json({ transcription: response.text });

  } catch (error) {
    console.error('Erro detalhado:', error);
    
    // Limpar arquivos temporários em caso de erro
    try {
      if (audioPath && fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
      if (mp3Path && fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);
    } catch (cleanupError) {
      console.error('Erro ao limpar arquivos temporários:', cleanupError);
    }

    let errorMessage = 'Erro ao processar vídeo do YouTube';
    if (error.message.includes('OPENAI_API_KEY')) {
      errorMessage = 'Erro de configuração: Chave da API OpenAI não configurada';
    } else if (error.message.includes('Status code: 429')) {
      errorMessage = 'Limite de requisições excedido. Tente novamente mais tarde';
    } else if (error.message.includes('private video')) {
      errorMessage = 'Este vídeo é privado e não pode ser processado';
    } else if (error.message.includes('WAV não foi criado')) {
      errorMessage = 'Erro na conversão do áudio. Tente novamente';
    } else if (error.message.includes('ffmpeg')) {
      errorMessage = 'Erro no processamento do áudio. Verifique se o FFmpeg está instalado corretamente';
    } else if (error.message.includes('todos os métodos')) {
      errorMessage = 'Não foi possível baixar o vídeo. Tente novamente mais tarde ou use outro vídeo.';
    }
    
    res.status(500).json({ 
      error: errorMessage,
      details: error.message
    });
  }
});

// Rota para transcrever Instagram
app.post('/api/transcribe-instagram', async (req, res) => {
  try {
    const { url, language } = req.body; // Adicionar parâmetro de idioma
    
    console.log('Processando Instagram:', url);
    
    // Para Instagram, você precisaria usar bibliotecas específicas
    // Por enquanto, simulação
    const transcription = `Transcrição simulada do Instagram: ${url}\n\nEsta é uma demonstração. Para Instagram funcionar de verdade, você precisa:\n1. Implementar downloader do Instagram (instaloader, etc.)\n2. Configurar autenticação se necessário\n3. Processar diferentes tipos de mídia (Reels, IGTV, Posts)\n\nO conteúdo seria baixado, convertido para MP3 e transcrito automaticamente.`;

    res.json({ transcription });

  } catch (error) {
    console.error('Erro Instagram:', error);
    res.status(500).json({ 
      error: 'Erro ao processar vídeo do Instagram: ' + error.message 
    });
  }
});

// Rota para upload de arquivo
app.post('/api/transcribe-file', upload.single('video'), async (req, res) => {
  let mp3Path = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const language = req.body.language;
    const shouldTranslate = req.body.shouldTranslate === 'true';
    const shouldFormat = req.body.shouldFormat === 'true';

    console.log('Processando arquivo:', req.file.filename);

    // Validar arquivo sem usar ffprobe
    try {
      const fileInfo = await validateMediaFile(req.file.path, req.file.originalname);
      console.log('Arquivo validado:', fileInfo);
    } catch (error) {
      console.error('Erro ao validar arquivo:', error);
      return res.status(400).json({ 
        error: 'Arquivo inválido: ' + error.message 
      });
    }

    // Definir caminho do arquivo de áudio
    const fileExtension = path.extname(req.file.filename);
    const baseName = path.basename(req.file.filename, fileExtension);
    mp3Path = path.join('uploads', `${baseName}_converted.wav`); // Usar WAV como padrão

    console.log('Convertendo para áudio...');

    // Converter para áudio compatível
    await convertVideoToAudio(req.file.path, mp3Path);

    let transcription;
    if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'sua-chave-aqui') {
      console.log('Enviando para Whisper...');
      
      const transcriptionParams = {
        file: fs.createReadStream(mp3Path),
        model: "whisper-1"
      };
      
      if (language && language !== 'auto') {
        transcriptionParams.language = language;
        console.log(`Idioma forçado: ${language}`);
      } else {
        console.log('Detecção automática de idioma');
      }
      
      const response = await openai.audio.transcriptions.create(transcriptionParams);
      transcription = response.text;

      // Processar o texto se solicitado
      if (shouldTranslate || shouldFormat) {
        console.log('Processando texto transcrito...');
        let processedText = transcription;

        if (shouldTranslate) {
          console.log('Traduzindo...');
          processedText = await translateText(processedText);
        }

        if (shouldFormat) {
          console.log('Formatando...');
          processedText = await formatText(processedText);
        }

        return res.json({ 
          originalTranscription: transcription,
          processedTranscription: processedText,
          operations: {
            translated: shouldTranslate,
            formatted: shouldFormat
          }
        });
      }
    } else {
      transcription = `Transcrição simulada do arquivo: ${req.file.originalname}\n\nEsta é uma demonstração. O arquivo foi recebido e processado com sucesso:\n- Nome: ${req.file.originalname}\n- Tamanho: ${(req.file.size / 1024 / 1024).toFixed(2)}MB\n- Tipo: ${req.file.mimetype}\n\nO arquivo foi convertido para MP3 e estaria pronto para transcrição.\nPara funcionar de verdade, configure sua chave da OpenAI.`;
    }

    res.json({ transcription });

  } catch (error) {
    console.error('Erro arquivo:', error);
    res.status(500).json({ 
      error: 'Erro ao processar arquivo: ' + error.message 
    });
  } finally {
    // Limpar arquivos
    cleanupFile(req.file?.path);
    cleanupFile(mp3Path);
  }
});

// Rota para obter idiomas suportados
app.get('/api/languages', (req, res) => {
  const languages = [
    { code: 'auto', name: 'Detectar Automaticamente' },
    { code: 'en', name: 'English' },
    { code: 'pt', name: 'Português' },
    { code: 'es', name: 'Español' },
    { code: 'fr', name: 'Français' },
    { code: 'de', name: 'Deutsch' },
    { code: 'it', name: 'Italiano' },
    { code: 'ja', name: '日本語' },
    { code: 'ko', name: '한국어' },
    { code: 'zh', name: '中文' },
    { code: 'ru', name: 'Русский' },
    { code: 'ar', name: 'العربية' },
    { code: 'hi', name: 'हिन्दी' },
    { code: 'nl', name: 'Nederlands' },
    { code: 'sv', name: 'Svenska' },
    { code: 'da', name: 'Dansk' },
    { code: 'no', name: 'Norsk' },
    { code: 'fi', name: 'Suomi' },
    { code: 'pl', name: 'Polski' },
    { code: 'tr', name: 'Türkçe' },
    { code: 'uk', name: 'Українська' },
    { code: 'cs', name: 'Čeština' },
    { code: 'hu', name: 'Magyar' },
    { code: 'ro', name: 'Română' },
    { code: 'bg', name: 'Български' },
    { code: 'hr', name: 'Hrvatski' },
    { code: 'sk', name: 'Slovenčina' },
    { code: 'sl', name: 'Slovenščina' },
    { code: 'et', name: 'Eesti' },
    { code: 'lv', name: 'Latviešu' },
    { code: 'lt', name: 'Lietuvių' }
  ];
  
  res.json({ languages });
});

// Rota de health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    hasOpenAI: !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'sua-chave-aqui'),
    ffmpegPath: ffmpegStatic
  });
});

// Rota para processar o texto (traduzir e formatar)
app.post('/api/process-text', async (req, res) => {
  try {
    const { text, shouldTranslate = true, shouldFormat = true } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Texto não fornecido' });
    }

    let processedText = text;

    // Traduzir se necessário
    if (shouldTranslate) {
      console.log('Traduzindo texto...');
      processedText = await translateText(processedText);
    }

    // Formatar se necessário
    if (shouldFormat) {
      console.log('Formatando texto...');
      processedText = await formatText(processedText);
    }

    res.json({ 
      processedText,
      operations: {
        translated: shouldTranslate,
        formatted: shouldFormat
      }
    });

  } catch (error) {
    console.error('Erro ao processar texto:', error);
    res.status(500).json({ 
      error: 'Erro ao processar texto: ' + error.message 
    });
  }
});

// Servir frontend em produção
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📱 Acesse: http://localhost:${PORT}`);
  console.log(`🔧 FFmpeg configurado: ${ffmpegStatic}`);
  console.log(`🤖 OpenAI configurado: ${!!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'sua-chave-aqui')}`);
  
  // Testar FFmpeg
  if (ffmpegStatic) {
    console.log('✅ FFmpeg encontrado e configurado');
  } else {
    console.log('❌ FFmpeg não encontrado - instale manualmente se necessário');
  }
});
