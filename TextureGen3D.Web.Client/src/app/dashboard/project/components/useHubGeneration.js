import { useCallback, useRef } from 'react';
import * as signalR from '@microsoft/signalr';
import { useProject } from '@/context/project';

// Shared SignalR generation helper (ComfyUI + Gradio) — both hubs expose the
// same GenerateImage method and ProgressUpdate/SeedUsed/GenerationComplete/
// GenerationError events.
// inputImage: optional base64 data URL used as the sole reference image —
// replaces the hub's angle/mesh reference lookup (used by the inpaint flow).
// SignalR caps messages at 32KB, so the image is uploaded via the API first
// and the hub resolves it by the returned id.
export function useHubGeneration() {
  const {
    token,
    id,
    selectedModelId,
    layerApi,
    textureResolution,
    setComfyProgress,
    setComfyMessage,
  } = useProject();

  const activeHubConnectionRef = useRef(null);

  const generateViaHub = useCallback(
    async ({ hubUrl, hubName, layer, meshDbId, fullPrompt, angleId, angleNum, totalAngles, inputImage }) => {
      // Upload the caller-supplied reference image via REST — SignalR's 32KB
      // message limit can't carry image data. The hub reads it back by id.
      let inputImageId = null;
      if (inputImage) {
        const upRes = await layerApi.saveProjectionImage(id, inputImage);
        if (!upRes.data?.success) throw new Error(upRes.data?.message || 'Failed to upload projection image');
        inputImageId = upRes.data.data?.imageId;
      }

      return new Promise((resolve, reject) => {
        const connection = new signalR.HubConnectionBuilder()
          .withUrl(hubUrl, { accessTokenFactory: () => token })
          .withAutomaticReconnect()
          .configureLogging(signalR.LogLevel.Information)
          .withServerTimeout(1000 * 60 * 60)
          .withKeepAliveInterval(15000)
          .build();
        activeHubConnectionRef.current = connection;

        connection.on('ProgressUpdate', (value, message) => {
          setComfyProgress(value);
          if (angleNum && totalAngles) {
            setComfyMessage(`Image ${angleNum}/${totalAngles}: ${message || 'Generating...'}`);
          } else if (message) {
            setComfyMessage(message);
          }
        });
        connection.on('SeedUsed', (seed) => {
          console.log(`[${hubName}] Seed used${angleNum ? ` (angle ${angleNum})` : ''}: ${seed ?? 'none'}`);
        });
        connection.on('GenerationComplete', async (base64Image) => {
          try {
            const saveRes = await layerApi.saveComfyUiResult(
              id,
              layer.id,
              meshDbId,
              base64Image
            );
            if (!saveRes.data?.success) throw new Error(`Failed to save ${hubName} result`);
            activeHubConnectionRef.current = null;
            await connection.stop();
            resolve(base64Image);
          } catch (err) {
            activeHubConnectionRef.current = null;
            await connection.stop();
            reject(err);
          }
        });
        connection.on('GenerationError', async (errorMsg, stackTrace) => {
          console.error(`${hubName} Generation Error${angleNum ? ` (angle ${angleNum})` : ''}:`, errorMsg);
          if (stackTrace) console.error('Stack trace:', stackTrace);
          activeHubConnectionRef.current = null;
          await connection.stop();
          reject(new Error(errorMsg));
        });
        connection
          .start()
          .then(() => {
            console.log(`[${hubName}] Connection started, invoking GenerateImage...`);
            connection.invoke(
              'GenerateImage',
              parseInt(selectedModelId),
              fullPrompt,
              id,
              meshDbId,
              layer.id,
              angleId || null,
              textureResolution,
              inputImageId
            );
          })
          .catch((err) => {
            console.error(`[${hubName}] Connection error:`, err);
            activeHubConnectionRef.current = null;
            connection.stop();
            reject(err);
          });
      });
    },
    [token, id, selectedModelId, layerApi, setComfyProgress, setComfyMessage, textureResolution]
  );

  return { generateViaHub, activeHubConnectionRef };
}
