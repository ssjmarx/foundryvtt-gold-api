import { Router } from "./baseRouter";
import { ModuleLogger } from "../../utils/logger";
import { recentRolls, moduleId, SETTINGS } from "../../constants";

export const router = new Router("rollRouter");

router.addRoute({
  actionType: "rolls",
  handler: async (data, context) => {
    const socketManager = context?.socketManager;
    
    // Basic test logging to see if this route is being called at all
    console.log("=== ROLL ROUTER CALLED ===");
    console.log("Received data:", JSON.stringify(data, null, 2));
    ModuleLogger.info(`Received request for roll data${data.clear || data.refresh ? ' with clear/refresh flag' : ''}`);

    // Handle clear/refresh flag to force fresh data
    if (data.clear || data.refresh) {
      console.log("=== REFRESH LOGIC TRIGGERED ===");
      ModuleLogger.info(`=== REFRESH DEBUG START ===`);
      ModuleLogger.info(`refresh flag received: ${data.refresh}`);
      ModuleLogger.info(`clear flag received: ${data.clear}`);
      ModuleLogger.info(`recentRolls length before clear: ${recentRolls.length}`);
      console.log("recentRolls before clear:", recentRolls.length);
      ModuleLogger.info(`game.messages available: ${!!game.messages}`);
      ModuleLogger.info(`game.messages length: ${game.messages?.contents?.length || 0}`);
      console.log("game.messages available:", !!game.messages);
      console.log("game.messages length:", game.messages?.contents?.length || 0);
      
      // Clear the recentRolls array
      recentRolls.length = 0;
      console.log("recentRolls after clear:", recentRolls.length);
      ModuleLogger.info(`recentRolls length after clear: ${recentRolls.length}`);
      
      // Always repopulate from chat log when refresh is requested
      if (data.refresh && game.messages) {
        console.log("=== STARTING REPOPULATION ===");
        ModuleLogger.info(`Starting repopulation from ${game.messages.contents?.length || 0} messages`);
        
        // Get the current state of game.messages (not reversed for proper chronological order)
        const messages = game.messages.contents;
        ModuleLogger.info(`Available messages to process: ${messages.length}`);
        console.log("Messages to process:", messages.length);
        
        // Populate recentRolls from roll messages in chronological order (newest first)
        let repopulatedCount = 0;
        for (let i = messages.length - 1; i >= 0; i--) {
          const message = messages[i];
          if ((message as any).isRoll && (message as any).rolls?.length > 0) {
            repopulatedCount++;
            
            // Generate a unique ID using the message ID to prevent duplicates
            const rollId = (message as any).id;

            // Format roll data to match the format used in createChatMessage hook
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

            // Add to recent rolls
            recentRolls.unshift(rollData);
            console.log(`Repopulated roll: ${rollData.formula} = ${rollData.rollTotal} from ${rollData.user?.name}`);
            ModuleLogger.info(`Repopulated roll: ${rollData.formula} = ${rollData.rollTotal} from ${rollData.user?.name}`);
          }
        }
        
        console.log("=== REPOPULATION COMPLETE ===");
        console.log("Repopulated count:", repopulatedCount);
        console.log("Final recentRolls length:", recentRolls.length);
        
        // Limit storage size for rolls
        const maxRollsStored = game.settings.get(moduleId, SETTINGS.MAX_ROLLS_STORED) as number || 20;
        if (recentRolls.length > maxRollsStored) {
          recentRolls.length = maxRollsStored;
          ModuleLogger.info(`Trimmed recentRolls to ${maxRollsStored} entries`);
          console.log("Trimmed recentRolls to:", maxRollsStored);
        }
        
        ModuleLogger.info(`Repopulated ${repopulatedCount} rolls from chat log`);
        ModuleLogger.info(`Final recentRolls length: ${recentRolls.length}`);
        ModuleLogger.info(`=== REFRESH DEBUG END ===`);
      } else {
        console.log("=== REPOPULATION SKIPPED ===");
        console.log("data.refresh:", data.refresh);
        console.log("game.messages exists:", !!game.messages);
      }
    } else {
      console.log("=== NO REFRESH/CLEAR FLAGS ===");
      console.log("data.clear:", data.clear);
      console.log("data.refresh:", data.refresh);
    }

    const responseData = recentRolls.slice(0, data.limit || 20);
    console.log("=== SENDING RESPONSE ===");
    console.log("Response data length:", responseData.length);
    console.log("Response data:", JSON.stringify(responseData, null, 2));

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
