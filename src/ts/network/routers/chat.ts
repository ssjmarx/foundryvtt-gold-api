import { Router } from "./baseRouter"
import { ModuleLogger } from "../../utils/logger"
import { moduleId } from "../../constants"

// Define interface for chat message structure
interface ChatMessage {
    id: string;
    messageId: string;
    user: {
        id: string;
        name: string;
    };
    content: string;
    flavor: string;
    type: string;
    timestamp: number;
    speaker: any;
    whisper: string[];
    blind: boolean;
}

// Universal message type mapping function for Foundry core compatibility
function mapToFoundryMessageType(type: string): string {
    const validCoreTypes = ['base', 'ic', 'ooc', 'roll', 'emote', 'other', 'player-chat'];
    
    // If already valid, return as-is
    if (validCoreTypes.includes(type)) {
        return type;
    }
    
    // Map common invalid types to valid ones
    const typeMappings: Record<string, string> = {
        'gm-message': 'base',
        'gm': 'base', 
        'dm': 'base',
        'player-chat': 'base',
        'whisper': 'ic',
        'blind': 'base',
        'private': 'ic'
    };
    
    // Return mapped type or default to 'base'
    return typeMappings[type] || 'base';
}

// Helper function to refresh chat messages and rolls from Foundry
function refreshChatData() {
    try {
        // Refresh chat messages from Foundry's game.messages
        const chatMessages = game.messages?.contents || [];
        if (!(window as any).recentChatMessages) {
            (window as any).recentChatMessages = [];
        }
        
        // Clear and rebuild the chat messages array
        (window as any).recentChatMessages.length = 0;
        
        chatMessages.forEach((message: any) => {
            if (!message.isRoll) {
                const chatData = {
                    id: message.id,
                    messageId: message.id,
                    user: {
                        id: message.user?.id,
                        name: message.user?.name
                    },
                    content: message.content,
                    flavor: message.flavor || "",
                    type: mapToFoundryMessageType(message.type) || "player-chat",
                    timestamp: message.timestamp || Date.now(),
                    speaker: message.speaker,
                    whisper: message.whisper || [],
                    blind: message.blind || false
                };
                (window as any).recentChatMessages.unshift(chatData);
            }
        });
        
        // Limit chat messages
        const maxStored = 100;
        if ((window as any).recentChatMessages.length > maxStored) {
            (window as any).recentChatMessages.length = maxStored;
        }
        
        ModuleLogger.debug(`Refreshed chat messages: ${(window as any).recentChatMessages.length} messages`);
    } catch (error) {
        ModuleLogger.error("Error refreshing chat messages:", error);
    }
}

export const router = new Router("chatRouter");

router.addRoute({
    actionType: "chat",
    handler: async (data, context) => {
        const socketManager = context?.socketManager;
        ModuleLogger.info("Received incoming chat message from relay server:", data);
        
        try {
            // Extract message data from the relay server format
            const messageData = data.message || data;
            
            if (!messageData || !messageData.message) {
                ModuleLogger.warn("Invalid chat message format - missing message content");
                return;
            }
            
            // Create chat message in Foundry
            const chatMessageData: any = {
                content: messageData.message,
                speaker: {
                    alias: messageData.speaker || "The Gold Box AI"
                },
                type: mapToFoundryMessageType(messageData.type) || "ic",
                flavor: messageData.flavor || ""
            };
            
            // Send the message to Foundry's chat
            await ChatMessage.create(chatMessageData);
            
            ModuleLogger.info(`Successfully created chat message from relay server: ${messageData.message.substring(0, 50)}...`);
            
            // Send confirmation back to relay server
            socketManager?.send({
                type: "chat-result",
                requestId: data.requestId,
                success: true,
                message: "Chat message delivered successfully"
            });
            
        } catch (error) {
            ModuleLogger.error("Error processing incoming chat message:", error);
            socketManager?.send({
                type: "chat-result",
                requestId: data.requestId,
                success: false,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
});

router.addRoute({
    actionType: "chat-messages",
    handler: async (data, context) => {
        const socketManager = context?.socketManager;
        ModuleLogger.info("Received request for chat messages:", data);
        
        try {
            const limit = data.limit || 50;
            const sort = data.sort || "timestamp";
            const order = data.order || "desc";
            const refresh = data.refresh || false;
            
            // Get messages from JavaScript module's storage first
            const module = game.modules.get(moduleId);
            let messages: ChatMessage[] = [];
            
            // Access messages from JavaScript module's API object
            if (module && (module as any).api && (module as any).api.getChatMessages) {
                messages = [...(module as any).api.getChatMessages()];
            } else {
                ModuleLogger.warn("Module API or getChatMessages method not available");
            }
            
            // Refresh data if requested (after getting current data for comparison)
            if (refresh) {
                ModuleLogger.info(`Refreshing chat data before returning messages. Current count: ${messages.length}, refresh flag: ${refresh}`);
                refreshChatData();
                
                // Re-get messages after refresh to ensure we have fresh data
                if (module && (module as any).api && (module as any).api.getChatMessages) {
                    messages = [...(module as any).api.getChatMessages()];
                }
                ModuleLogger.info(`After refresh - new message count: ${messages.length}`);
            }
            
            // Apply sorting
            if (sort === "timestamp") {
                messages.sort((a, b) => {
                    return order === "desc" ? b.timestamp - a.timestamp : a.timestamp - b.timestamp;
                });
            }
            
            // Apply limit
            const limitedMessages = messages.slice(0, limit);
            
            ModuleLogger.info(`Returning ${limitedMessages.length} chat messages`);
            
            // Send response back
            socketManager?.send({
                type: "chat-messages-result",
                requestId: data.requestId,
                messages: limitedMessages,
                total: messages.length
            });
            
        } catch (error) {
            ModuleLogger.error("Error processing chat messages request:", error);
            socketManager?.send({
                type: "chat-messages-result",
                requestId: data.requestId,
                error: error instanceof Error ? error.message : String(error),
                messages: []
            });
        }
    }
});
