const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const API_BASE = 'http://localhost:5010'; // Using 5010 to avoid conflict and test if it starts
const IMAGE_PATH = 'C:/Users/tharu/.gemini/antigravity/brain/037b3f5a-5a87-40b3-89e0-c638c9d1cff3/test_parking_slot_1774075125599.png';

async function testAnalysis() {
    console.log(`Starting API Verification with real image: ${IMAGE_PATH}`);
    
    if (!fs.existsSync(IMAGE_PATH)) {
        console.error('Test image not found!');
        process.exit(1);
    }

    const form = new FormData();
    form.append('image', fs.createReadStream(IMAGE_PATH));

    try {
        console.log('Sending POST request to /api/analyze-parking...');
        // Node 18+ has global fetch
        const response = await fetch(`${API_BASE}/api/analyze-parking`, {
            method: 'POST',
            body: form,
            headers: form.getHeaders()
        });

        const status = response.status;
        const data = await response.json();
        console.log(`Status: ${status}`);
        console.log(`Response:`, JSON.stringify(data, null, 2));
        
        if (status === 200) {
            console.log(`✅ AI Analysis is working!`);
            console.log(`Model Used: ${data.modelUsed}`);
            console.log(`Car Detected: ${data.carDetected}`);
            console.log(`Parking Status: ${data.parkingStatus}`);
            process.exit(0);
        } else {
            console.log(`❌ Analysis failed with status ${status}`);
            process.exit(1);
        }
    } catch (err) {
        console.error(`❌ Error:`, err.message);
        process.exit(1);
    }
}

// Wait a bit for server to start
setTimeout(testAnalysis, 5000);
