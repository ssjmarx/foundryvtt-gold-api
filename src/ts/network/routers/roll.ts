import { Router } from "./baseRouter";
import { ModuleLogger } from "../../utils/logger";
import { recentRolls, moduleId, SETTINGS } from "../../constants";

export const router = new Router("rollRouter");

router.addRoute({
  actionType: "rolls",
  handler: async (data, context) => {
    const socketManager = context?.socketManager;
    
    console.log("=== ROLL ROUTER CALLED ===");
    console.log("Received data:", JSON.stringify(data, null, 2));
    ModuleLogger.info(`Received request for roll data${data.clear || data.refresh ? ' with clear/refresh flag' : ''}`);

    // Enhanced refresh logic with multiple data collection strategies
    if (data.clear || data.refresh) {
      console.log("=== ENHANCED REFRESH LOGIC TRIGGERED ===");
      ModuleLogger.info(`=== ENHANCED REFRESH START ===`);
      ModuleLogger.info(`refresh flag received: ${data.refresh}`);
      ModuleLogger.info(`clear flag received: ${data.clear}`);
      ModuleLogger.info(`recentRolls length before clear: ${recentRolls.length}`);
      
      // Step 1: Complete cache invalidation
      recentRolls.length = 0;
      console.log("recentRolls after clear:", 0);
      ModuleLogger.info(`recentRolls length after clear: ${recentRolls.length}`);

      // Step 2: Multi-strategy data collection
      let collectedCount = 0;

      // Strategy 1: Use game.messages if available (primary method)
      if (game.messages && game.messages.contents) {
        console.log("=== STRATEGY 1: USING GAME.MESSAGES ===");
        const messages = game.messages.contents;
        ModuleLogger.info(`Processing ${messages.length} messages from game.messages`);
        
        for (let i = messages.length - 1; i >= 0; i--) {
          const message = messages[i];
          if ((message as any).isRoll && (message as any).rolls?.length > 0) {
            collectedCount++;
            
            const rollId = (message as any).id;
            const rollData = {
              id: rollId,
              messageId: (message as any).id,
              flavor: (message as any).flavor || "",
              rollTotal: (message as any).rolls[0].total,
              formula: (message as any).rolls[0].formula,
              isCritical: (message as any).rolls[0].isCritical || false,
              isFumble: (message as any).rolls[0].isFumble || false,
              dice: (message as any).rolls[0].dice?.map((d: any) => ({
                faces: d.faces,
                results: d.results.map((r: any) => ({
                  result: r.result,
                  active: r.active
                }))
              })) || [],
              user: {
                id: (message as any).user?.id,
                name: (message as any).user?.name || 'Unknown'
              },
              timestamp: (message as any).timestamp || Date.now()
            };

            recentRolls.unshift(rollData);
            ModuleLogger.info(`Collected roll from game.messages: ${rollData.formula} = ${rollData.rollTotal} from ${rollData.user?.name}`);
          }
        }
      }

      // Strategy 2: DOM scanning as backup (catches missed rolls)
      console.log("=== STRATEGY 2: DOM SCANNING BACKUP ===");
      const chatMessages = Array.from(document.querySelectorAll('.chat-message'));
      ModuleLogger.info(`Scanning ${chatMessages.length} chat messages from DOM as backup`);
      
      for (const element of chatMessages) {
        if (element.classList.contains('dice-roll')) {
          const rollId = element.getAttribute('data-message-id') || `dom_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
          
          // Extract roll data from DOM
          const formulaElement = element.querySelector('.roll-formula');
          const totalElement = element.querySelector('.roll-total');
          const flavorElement = element.querySelector('.message-content');
          const userElement = element.querySelector('.message-sender');
          
          if (formulaElement && totalElement && !recentRolls.find(r => r.id === rollId)) {
            const rollData = {
              id: rollId,
              messageId: rollId,
              flavor: flavorElement?.textContent?.trim() || "",
              rollTotal: parseInt(totalElement.textContent?.replace(/[^\d-]/g, '') || '0'),
              formula: formulaElement.textContent?.trim() || "",
              isCritical: element.classList.contains('critical') || false,
              isFumble: element.classList.contains('fumble') || false,
              dice: [], // Would need more complex DOM parsing for dice details
              user: {
                id: '',
                name: userElement?.textContent?.trim() || 'Unknown'
              },
              timestamp: Date.now()
            };
            
            recentRolls.unshift(rollData);
            collectedCount++;
            ModuleLogger.info(`Collected roll from DOM: ${rollData.formula} = ${rollData.rollTotal} from ${rollData.user?.name}`);
          }
        }
      }

      // Strategy 3: Canvas UI elements as tertiary fallback
      console.log("=== STRATEGY 3: CANVAS UI FALLBACK ===");
      if (canvas && canvas.tokens && canvas.tokens?.controlled) {
        const controlledTokens = canvas.tokens?.controlled;
        if (controlledTokens && controlledTokens.length > 0) {
          // Check for recent roll results in token sheets or UI
          const recentRollElements = Array.from(document.querySelectorAll('.dice-result, .roll-result'));
          ModuleLogger.info(`Found ${recentRollElements.length} roll result elements in UI`);
          
          for (const element of recentRollElements) {
            const rollText = element.textContent?.trim();
            if (rollText && /\d+/.test(rollText)) {
              const rollId = `ui_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
              if (!recentRolls.find(r => r.id === rollId)) {
                const rollData = {
                  id: rollId,
                  messageId: rollId,
                  flavor: "",
                  rollTotal: parseInt(rollText.match(/\d+/)?.[0] || '0'),
                  formula: "unknown",
                  isCritical: false,
                  isFumble: false,
                  dice: [],
                  user: {
                    id: '',
                    name: 'UI Roll'
                  },
                  timestamp: Date.now()
                };
                
                recentRolls.unshift(rollData);
                collectedCount++;
                ModuleLogger.info(`Collected roll from UI: ${rollData.rollTotal} from UI element`);
              }
            }
          }
        }
      }

      // Step 3: Sort and limit results
      recentRolls.sort((a, b) => b.timestamp - a.timestamp);
      const maxRollsStored = game.settings.get(moduleId, SETTINGS.MAX_ROLLS_STORED) as number || 20;
      if (recentRolls.length > maxRollsStored) {
        recentRolls.length = maxRollsStored;
      }
      
      console.log("=== ENHANCED REFRESH COMPLETE ===");
      console.log(`Total rolls collected: ${collectedCount}`);
      console.log(`Final recentRolls length: ${recentRolls.length}`);
      console.log("Strategies used: game.messages, DOM scanning, UI fallback");
      ModuleLogger.info(`Enhanced refresh complete: ${collectedCount} rolls collected using multiple strategies`);
      ModuleLogger.info(`Final recentRolls length: ${recentRolls.length}`);
      ModuleLogger.info(`=== ENHANCED REFRESH END ===`);
    } else {
      console.log("=== NO REFRESH/CLEAR FLAGS ===");
      console.log(`data.clear: ${data.clear}, data.refresh: ${data.refresh}`);
    }

    // Return the current state of recentRolls
    const responseData = recentRolls.slice(0, data.limit || 20);
    console.log("=== SENDING RESPONSE ===");
    console.log("Response data length:", responseData.length);
    console.log(`Rolls in response: ${responseData.map(r => `${r.formula}=${r.rollTotal}`).join(', ')}`);

    socketManager?.send({
      type: "rolls-result",
      requestId: data.requestId,
      data: responseData
    });
  }
});

router.addRoute({
  actionType: "last-roll",
  handler: (data, context) => {
    const socketManager = context?.socketManager;
    ModuleLogger.info(`Received request for last roll data`);

    socketManager?.send({
      type: "last-roll-result",
      requestId: data.requestId,
      data: recentRolls.length > 0 ? recentRolls[0] : null
    });
  }
});

router.addRoute({
  actionType: "roll",
  handler: async (data, context) => {
    const socketManager = context?.socketManager;
    try {
      const { formula, flavor, createChatMessage, speaker, whisper, requestId } = data;

      let rollResult;
      let speakerData = {};
      let rollMode = whisper && whisper.length > 0 ? CONST.DICE_ROLL_MODES.PRIVATE : CONST.DICE_ROLL_MODES.PUBLIC;

      // Process speaker if provided
      if (speaker) {
        try {
          const speakerEntity = await fromUuid(speaker);

          if (speakerEntity) {
            if (speakerEntity instanceof TokenDocument) {
              speakerData = {
                token: speakerEntity?.id,
                actor: speakerEntity?.actor?.id,
                scene: speakerEntity?.parent?.id,
                alias: speakerEntity?.name || speakerEntity?.actor?.name
              };
            } else if (speakerEntity instanceof Actor) {
              const activeScene = game.scenes?.active;
              if (activeScene) {
                const tokens = activeScene.tokens?.filter(t => t.actor?.id === speakerEntity.id);
                if (tokens && tokens.length > 0) {
                  const token = tokens[0];
                  speakerData = {
                    token: token.id,
                    actor: speakerEntity.id,
                    scene: activeScene.id,
                    alias: token.name || speakerEntity.name
                  };
                } else {
                  speakerData = {
                    actor: speakerEntity.id,
                    alias: speakerEntity.name
                  };
                }
              }
            }
          }
        } catch (err) {
          ModuleLogger.warn(`Failed to process speaker: ${err}`);
        }
      }

      try {
        const roll = new Roll(formula);

        await roll.evaluate();

        if (createChatMessage) {
          await roll.toMessage({
            speaker: speakerData,
            flavor: flavor || "",
            rollMode,
            whisper: whisper || []
          });
        }

        rollResult = {
          id: `manual_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
          chatMessageCreated: !!createChatMessage,
          roll: {
            formula: formula,
            total: roll.total,
            isCritical: roll.terms.some(term => (term as DiceTerm).results?.some(result => result.result === (roll.terms[0] as DiceTerm).faces)),
            isFumble: roll.terms.some(term => (term as DiceTerm).results?.some(result => result.result === 1)),
            dice: roll.dice.map(d => ({
              faces: d.faces,
              results: d.results.map(r => ({
                result: r.result,
                active: r.active
              }))
            })),
            timestamp: Date.now()
          }
        };
      } catch (err) {
        ModuleLogger.error(`Error rolling formula: ${err}`);
        socketManager?.send({
          type: "roll-result",
          requestId: requestId,
          success: false,
          error: `Failed to roll formula: ${(err as Error).message}`
        });
        return;
      }

      socketManager?.send({
        type: "roll-result",
        requestId: requestId,
        success: true,
        data: rollResult
      });
    } catch (error) {
      ModuleLogger.error(`Error in roll handler: ${error}`);
      socketManager?.send({
        type: "roll-result",
        requestId: data.requestId,
        success: false,
        error: (error as Error).message || "Unknown error occurred during roll"
      });
    }
  }
});
