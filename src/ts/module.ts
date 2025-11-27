import "../styles/style.scss";
import { FoundryRestApi } from "./types";
import { moduleId, recentRolls, CONSTANTS, SETTINGS } from "./constants";

// Chat message storage
declare global {
  var recentChatMessages: any[];
}
import { ModuleLogger } from "./utils/logger";
import { initializeWebSocket } from "./network/webSocketEndpoints";

// Declare QuickInsert interface
declare global {
  interface Window {
    QuickInsert: {
      open: (context: any) => void;
      search: (text: string, filter?: ((item: any) => boolean) | null, max?: number) => Promise<any[]>;
      forceIndex: () => void;
      handleKeybind: (event: KeyboardEvent, context: any) => void;
      hasIndex: boolean;
    };
  }
}

Hooks.once("init", () => {
  console.log(`Initializing ${moduleId}`);
  
  for (let [name, data] of Object.entries(SETTINGS.GET_DEFAULT())) {
    game.settings.register(CONSTANTS.MODULE_ID, name, <any>data);
  }

  // Create and expose module API
  const module = game.modules.get(moduleId) as FoundryRestApi;
  module.api = {
    getWebSocketManager: () => {
      if (!module.socketManager) {
        ModuleLogger.warn(`WebSocketManager requested but not initialized`);
        return null;
      }
      return module.socketManager;
    },
    search: async (query: string, filter?: string) => {
      if (!window.QuickInsert) {
        ModuleLogger.error(`QuickInsert not available`);
        return [];
      }
      
      if (!window.QuickInsert.hasIndex) {
        ModuleLogger.info(`QuickInsert index not ready, forcing index creation`);
        try {
          window.QuickInsert.forceIndex();
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          ModuleLogger.error(`Failed to force QuickInsert index:`, error);
        }
      }
      
      let filterFunc = null;
      if (filter) {
        filterFunc = (item: any) => item.documentType === filter;
      }
      
      return window.QuickInsert.search(query, filterFunc, 100);
    },
    getByUuid: async (uuid: string) => {
      try {
        return await fromUuid(uuid);
      } catch (error) {
        ModuleLogger.error(`Error getting entity by UUID:`, error);
        return null;
      }
    },
    getChatMessages: (limit: number = 50) => {
      ModuleLogger.info(`getChatMessages called with limit: ${limit}`);
      // This will be populated by the chat message collection hook
      // The actual messages are stored in the recentChatMessages array in the compiled module
      return (window as any).recentChatMessages?.slice(0, limit) || [];
    }
  };
});

// Replace the API key input field with a password field
Hooks.on("renderSettingsConfig", (_: SettingsConfig, html: JQuery | HTMLElement) => {
  const htmlJQuery = html instanceof HTMLElement ? $(html) : html;
  const apiKeyInput = htmlJQuery.find(`input[name="${moduleId}.apiKey"]`);
  if (apiKeyInput.length) {
    // Change the input type to password
    apiKeyInput.attr("type", "password");

    // Add a button to show the client ID
    const showClientInfoButton = $('<button type="button" style="margin-left: 10px;"><i class="fas fa-info-circle"></i> Show Client Info</button>');
    apiKeyInput.after(showClientInfoButton);

    showClientInfoButton.on("click", () => {
      const module = game.modules.get(moduleId) as FoundryRestApi;
      const webSocketManager = module.api.getWebSocketManager();
      if (webSocketManager) {
        const clientId = webSocketManager.getClientId();
        const worldId = game.world.id;
        const worldTitle = (game.world as any).title;
        const foundryVersion = game.version;
        const systemId = game.system.id;
        const systemTitle = (game.system as any).title || game.system.id;
        const systemVersion = (game.system as any).version || 'unknown';
        const customName = game.settings.get(moduleId, "customName") as string;
        
        new Dialog({
          title: "Client Information",
          content: `
            <div class="form-group">
                <label>Client ID</label>
                <div class="form-fields">
                    <input type="text" value="${clientId}" readonly>
                </div>
            </div>
            <div class="form-group">
                <label>World ID</label>
                <div class="form-fields">
                    <input type="text" value="${worldId}" readonly>
                </div>
            </div>
            <div class="form-group">
                <label>World Title</label>
                <div class="form-fields">
                    <input type="text" value="${worldTitle}" readonly>
                </div>
            </div>
            <div class="form-group">
                <label>Foundry Version</label>
                <div class="form-fields">
                    <input type="text" value="${foundryVersion}" readonly>
                </div>
            </div>
            <div class="form-group">
                <label>System ID</label>
                <div class="form-fields">
                    <input type="text" value="${systemId}" readonly>
                </div>
            </div>
            <div class="form-group">
                <label>System Title</label>
                <div class="form-fields">
                    <input type="text" value="${systemTitle}" readonly>
                </div>
            </div>
            <div class="form-group">
                <label>System Version</label>
                <div class="form-fields">
                    <input type="text" value="${systemVersion}" readonly>
                </div>
            </div>
            <div class="form-group">
                <label>Custom Name</label>
                <div class="form-fields">
                    <input type="text" value="${customName}" readonly>
                </div>
            </div>
            <p class="notes">Click any field to copy its value.</p>
          `,
          buttons: {
            ok: {
              label: "OK"
            }
          },
          render: (html: JQuery | HTMLElement) => {
            const htmlJQuery = html instanceof HTMLElement ? $(html) : html;
            const inputs = htmlJQuery.find('input[type="text"]');
            inputs.css('cursor', 'pointer');
            inputs.on('click', (event: JQuery.ClickEvent) => {
              const input = event.currentTarget;
              navigator.clipboard.writeText(input.value).then(() => {
                ui.notifications.info(`Copied to clipboard.`);
                input.select();
              });
            });
          }
        }).render(true);
      } else {
        ui.notifications.warn("WebSocketManager is not available.");
      }
    });

    // Add an event listener to save the value when it changes
    apiKeyInput.on("change", (event) => {
      const newValue = (event.target as HTMLInputElement).value;
      game.settings.set(moduleId, "apiKey", newValue).then(() => {
        new Dialog({
          title: "Reload Required",
          content: "<p>The API Key has been updated. A reload is required for the changes to take effect. Would you like to reload now?</p>",
          buttons: {
            yes: {
              label: "Reload",
              callback: () => window.location.reload()
            },
            no: {
              label: "Later"
            }
          },
          default: "yes"
        }).render(true);
      });
    });
  }

  // Handle custom name changes
  const customNameInput = htmlJQuery.find(`input[name="${moduleId}.customName"]`);
  if (customNameInput.length) {
    customNameInput.on("change", (event) => {
      const newValue = (event.target as HTMLInputElement).value;
      game.settings.set(moduleId, "customName", newValue).then(() => {
        new Dialog({
          title: "Reload Required",
          content: "<p>The Custom Name has been updated. A reload is required for the changes to take effect. Would you like to reload now?</p>",
          buttons: {
            yes: {
              label: "Reload",
              callback: () => window.location.reload()
            },
            no: {
              label: "Later"
            }
          },
          default: "yes"
        }).render(true);
      });
    });
  }
});

Hooks.once("ready", () => {
  // Initialize chat messages array
  if (!(window as any).recentChatMessages) {
    (window as any).recentChatMessages = [];
  }
  
  // Populate chat messages from existing Foundry chat log
  try {
    const chatMessages = game.messages?.contents || [];
    ModuleLogger.info(`Found ${chatMessages.length} existing chat messages to populate recentChatMessages and recentRolls`);
    
    // Convert existing chat messages to our format
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
          type: message.type || "player-chat",
          timestamp: message.timestamp || Date.now(),
          speaker: message.speaker,
          whisper: message.whisper || [],
          blind: message.blind || false
        };
        
        // Add to global chat messages array
        if (!(window as any).recentChatMessages) {
          (window as any).recentChatMessages = [];
        }
        
        const existingIndex = (window as any).recentChatMessages.findIndex((m: any) => m.id === message.id);
        if (existingIndex !== -1) {
          (window as any).recentChatMessages[existingIndex] = chatData;
        } else {
          (window as any).recentChatMessages.unshift(chatData);
        }
      } else if (message.isRoll && message.rolls?.length > 0) {
        // Populate recentRolls from historical roll messages
        const rollId = message.id;
        
        // Format roll data to match the format used in createChatMessage hook
        const rollData = {
          id: rollId,
          messageId: message.id,
          user: {
            id: message.user?.id,
            name: message.user?.name
          },
          speaker: message.speaker,
          flavor: message.flavor || "",
          rollTotal: message.rolls[0].total,
          formula: message.rolls[0].formula,
          isCritical: message.rolls[0].isCritical || false,
          isFumble: message.rolls[0].isFumble || false,
          dice: message.rolls[0].dice?.map((d: any) => ({
            faces: d.faces,
            results: d.results.map((r: any) => ({
              result: r.result,
              active: r.active
            }))
          })),
          timestamp: message.timestamp || Date.now()
        };
        
        // Check if this roll ID already exists in recentRolls
        const existingIndex = recentRolls.findIndex(roll => roll.id === rollId);
        if (existingIndex !== -1) {
          // If it exists, update it instead of adding a new entry
          recentRolls[existingIndex] = rollData;
        } else {
          // Add to recent rolls
          recentRolls.unshift(rollData);
        }
        
        ModuleLogger.debug(`Populated historical roll: ${rollData.formula} = ${rollData.rollTotal} from ${rollData.user?.name}`);
      }
    });
    
    // Limit storage size for chat messages
    const maxStored = 100;
    if ((window as any).recentChatMessages.length > maxStored) {
      (window as any).recentChatMessages.length = maxStored;
    }
    
    // Limit storage size for rolls
    const maxRollsStored = game.settings.get(moduleId, SETTINGS.MAX_ROLLS_STORED) as number;
    if (recentRolls.length > maxRollsStored) {
      recentRolls.length = maxRollsStored;
    }
    
    ModuleLogger.info(`Populated recentChatMessages with ${(window as any).recentChatMessages.length} messages from existing chat log`);
    ModuleLogger.info(`Populated recentRolls with ${recentRolls.length} rolls from existing chat log`);
  } catch (error) {
    ModuleLogger.error(`Error populating chat messages and rolls from existing log:`, error);
  }
  
  setTimeout(() => {
    initializeWebSocket();
  }, 1000);
});

Hooks.on("createChatMessage", (message: any) => {
  // Handle chat messages (non-rolls)
  if (!message.isRoll) {
    ModuleLogger.info(`Collecting chat message from ${message.user?.name || 'unknown'}`);
    
    const chatData = {
      id: message.id,
      messageId: message.id,
      user: {
        id: message.user?.id,
        name: message.user?.name
      },
      content: message.content,
      flavor: message.flavor || "",
      type: message.type || "player-chat",
      timestamp: Date.now(),
      speaker: message.speaker,
      whisper: message.whisper || [],
      blind: message.blind || false
    };
    
    // Add to global chat messages array
    if (!(window as any).recentChatMessages) {
      (window as any).recentChatMessages = [];
    }
    
    const existingIndex = (window as any).recentChatMessages.findIndex((m: any) => m.id === message.id);
    if (existingIndex !== -1) {
      (window as any).recentChatMessages[existingIndex] = chatData;
    } else {
      (window as any).recentChatMessages.unshift(chatData);
    }
    
    // Limit storage size
    const maxStored = 100;
    if ((window as any).recentChatMessages.length > maxStored) {
      (window as any).recentChatMessages.length = maxStored;
    }
  }
  
  // Handle rolls
  if (message.isRoll && message.rolls?.length > 0) {
    ModuleLogger.info(`Detected dice roll from ${message.user?.name || 'unknown'}`);
    
    // Generate a unique ID using the message ID to prevent duplicates
    const rollId = message.id;
    
    // Format roll data
    const rollData = {
      id: rollId,
      messageId: message.id,
      user: {
        id: message.user?.id,
        name: message.user?.name
      },
      speaker: message.speaker,
      flavor: message.flavor || "",
      rollTotal: message.rolls[0].total,
      formula: message.rolls[0].formula,
      isCritical: message.rolls[0].isCritical || false,
      isFumble: message.rolls[0].isFumble || false,
      dice: message.rolls[0].dice?.map((d: any) => ({
        faces: d.faces,
        results: d.results.map((r: any) => ({
          result: r.result,
          active: r.active
        }))
      })),
      timestamp: Date.now()
    };
    
    // Check if this roll ID already exists in recentRolls
    const existingIndex = recentRolls.findIndex(roll => roll.id === rollId);
    if (existingIndex !== -1) {
      // If it exists, update it instead of adding a new entry
      recentRolls[existingIndex] = rollData;
    } else {
      // Add to recent rolls
      recentRolls.unshift(rollData);
      
      // Trim the array if needed
      const maxRollsStored = game.settings.get(moduleId, SETTINGS.MAX_ROLLS_STORED) as number;
      if (recentRolls.length > maxRollsStored) {
        recentRolls.length = maxRollsStored;
      }
    }
    
    // Send to relay server if connected
    const module = game.modules.get(moduleId) as FoundryRestApi;
    if (module.socketManager?.isConnected()) {
      module.socketManager.send({
        type: "roll-data",
        data: rollData
      });
    }
  }
});
