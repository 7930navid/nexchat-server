import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import crypto from 'crypto';

const app = express();

// ==========================================
// 1. SERVER CONFIGURATION
// ==========================================

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ==========================================
// 2. GROQ CLIENT
// ==========================================

// Environment variable-এ Groq API key সেট করবে।
const apiKey = process.env.API;

if (!apiKey) {
    throw new Error('GROQ_API_KEY environment variable is missing!');
}

const client = new OpenAI({
    apiKey: apiKey,
    baseURL: 'https://api.groq.com/openai/v1'
});

// ==========================================
// 3. CHAT MEMORY
// ==========================================

// প্রতিটি session-এর আলাদা memory
const sessions = Object.create(null);

// System prompt
const SYSTEM_PROMPT = {
    role: 'system',
    content:
        'You are a helpful AI education assistant. ' +
        'Answer politely and concisely in Bangla or English.'
};

// সর্বশেষ কতটি chat message রাখা হবে
const MAX_CHAT_MESSAGES = 7;

// ==========================================
// 4. LIMIT CHAT HISTORY
// ==========================================

function limitChatHistory(sessionId) {
    const messages = sessions[sessionId];

    if (!messages) return;

    // System prompt বাদ দিয়ে শুধু chat messages
    const systemPrompt = messages[0];
    const chatMessages = messages.slice(1);

    // সর্বশেষ ৭টি user/assistant message
    const recentMessages = chatMessages.slice(
        -MAX_CHAT_MESSAGES
    );

    // System prompt + সর্বশেষ ৭টি message
    sessions[sessionId] = [
        systemPrompt,
        ...recentMessages
    ];
}

// ==========================================
// 5. CHAT API
// ==========================================

app.post('/api/chat', async (req, res) => {
    try {
        const { prompt, sessionId } = req.body ?? {};

        // Validate prompt
        if (
            typeof prompt !== 'string' ||
            !prompt.trim()
        ) {
            return res.status(400).json({
                error: 'Prompt is required'
            });
        }

        // Prompt length limit
        if (prompt.length > 10000) {
            return res.status(413).json({
                error: 'Prompt is too long'
            });
        }

        // Session ID না থাকলে নতুন তৈরি
        const currentSessionId =
            typeof sessionId === 'string' &&
            sessionId.length > 0 &&
            sessionId.length <= 200
                ? sessionId
                : crypto.randomUUID();

        // নতুন session-এর memory তৈরি
        if (!sessions[currentSessionId]) {
            sessions[currentSessionId] = [
                { ...SYSTEM_PROMPT }
            ];
        }

        // বর্তমান session-এর message history
        let messages = sessions[currentSessionId];

        // User message যোগ
        messages.push({
            role: 'user',
            content: prompt.trim()
        });

        // API call-এর আগে সর্বশেষ ৭টি message রাখবে
        limitChatHistory(currentSessionId);

        messages = sessions[currentSessionId];

        // ======================================
        // 6. GROQ API REQUEST
        // ======================================

        const chatCompletion =
            await client.chat.completions.create({
                model: 'openai/gpt-oss-120b',
                messages: messages
            });

        const aiReply =
            chatCompletion.choices[0]?.message?.content ||
            'No response';

        // AI response memory-তে যোগ
        messages.push({
            role: 'assistant',
            content: aiReply
        });

        // আবার limit প্রয়োগ
        limitChatHistory(currentSessionId);

        // ======================================
        // 7. SEND RESPONSE
        // ======================================

        return res.json({
            reply: aiReply,
            sessionId: currentSessionId
        });

    } catch (error) {
        console.error(
            'NexChat server error:',
            error.message
        );

        if (error.status === 429) {
            return res.status(429).json({
                error: 'API rate limit reached. Please try again later.'
            });
        }

        return res.status(500).json({
            error: 'দুঃখিত, সার্ভারে একটি সমস্যা হয়েছে। আবার চেষ্টা করুন।'
        });
    }
});

// ==========================================
// 8. HEALTH CHECK
// ==========================================

app.get('/', (req, res) => {
    res.status(200).send('NexChat Server is running!');
});

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        service: 'NexChat'
    });
});

// ==========================================
// 9. START SERVER
// ==========================================

app.listen(PORT, () => {
    console.log(
        `NexChat Server is running on port ${PORT}`
    );
});