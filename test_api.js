const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function testGemini() {
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // Use gemini-flash-latest instead
    const modelId = 'gemini-flash-latest'; 
    console.log(`Testing model: ${modelId}`);

    try {
        const model = genAI.getGenerativeModel({ model: modelId });
        const result = await model.generateContent("Hello?");
        const response = await result.response;
        console.log(`✅ Model ${modelId} is working! Response: ${response.text()}`);
    } catch (err) {
        console.error(`❌ Model ${modelId} failed: ${err.message}`);
    }
}

testGemini();
