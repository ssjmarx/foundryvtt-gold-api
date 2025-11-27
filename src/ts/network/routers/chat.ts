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

export const router = new Router("chatRouter");

router.addRoute({
    actionType: "chat-messages",
    handler: async (data, context) => {
        const socketManager = context?.socketManager;
        ModuleLogger.info("Received request for chat messages:", data);
        
        try {
            const limit = data.limit || 50;
            const sort = data.sort || "timestamp";
            const order = data.order || "desc";
            
            // Get messages from JavaScript module's storage
            const module = game.modules.get(moduleId);
            let messages: ChatMessage[] = [];
            
            // Access messages from JavaScript module's API object
            if (module && (module as any).api && (module as any).api.getChatMessages) {
                messages = [...(module as any).api.getChatMessages()];
            } else {
                ModuleLogger.warn("Module API or getChatMessages method not available");
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
