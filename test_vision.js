const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function testGeminiVision() {
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // Test multiple models for vision
    const modelsToTry = [
        'gemini-flash-latest',
        'gemini-1.5-flash',
        'gemini-2.0-flash' // I saw it has 429 but let's see
    ];

    const imagePath = 'C:/Users/tharu/.gemini/antigravity/brain/037b3f5a-5a87-40b3-89e0-c638c9d1cff3/test_parking_slot_1774075125599.png';
    const base64Image = fs.readFileSync(imagePath).toString('base64');

    for (const modelId of modelsToTry) {
        console.log(`\nTesting VISION with model: ${modelId}`);
        try {
            const model = genAI.getGenerativeModel({ model: modelId });
            const result = await model.generateContent([
                { inlineData: { data: base64Image, mimeType: 'image/png' } },
                "What do you see in this image? Return JSON format."
            ]);
            const response = await result.response;
            console.log(`✅ Model ${modelId} VISION is working!`);
            console.log(`Response: ${response.text().substring(0, 100)}...`);
            break; 
        } catch (err) {
            console.error(`❌ Model ${modelId} failed: ${err.message}`);
        }
    }
}

testGeminiVision();
