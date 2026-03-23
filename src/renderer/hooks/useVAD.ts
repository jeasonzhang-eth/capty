import { useState, useCallback, useRef } from 'react'

interface VADState {
  readonly isSpeaking: boolean
  readonly isLoaded: boolean
}

interface VADCallbacks {
  readonly onSpeechStart?: () => void
  readonly onSpeechEnd?: (audio: Float32Array) => void
}

export function useVAD(callbacks: VADCallbacks = {}) {
  const [state, setState] = useState<VADState>({
    isSpeaking: false,
    isLoaded: false,
  })

  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks

  // Buffer to accumulate audio during speech
  const audioBufferRef = useRef<Float32Array[]>([])
  const isSpeakingRef = useRef(false)

  const processSample = useCallback(
    (float32Audio: Float32Array, isSpeech: boolean) => {
      if (isSpeech && !isSpeakingRef.current) {
        // Speech started
        audioBufferRef.current = []
        isSpeakingRef.current = true
        setState((prev) => ({ ...prev, isSpeaking: true }))
        callbacksRef.current.onSpeechStart?.()
      } else if (!isSpeech && isSpeakingRef.current) {
        // Speech ended - concatenate buffered audio
        const totalLength = audioBufferRef.current.reduce(
          (sum, buf) => sum + buf.length,
          0,
        )
        const combined = new Float32Array(totalLength)
        let offset = 0
        for (const buf of audioBufferRef.current) {
          combined.set(buf, offset)
          offset += buf.length
        }
        isSpeakingRef.current = false
        setState((prev) => ({ ...prev, isSpeaking: false }))
        callbacksRef.current.onSpeechEnd?.(combined)
        audioBufferRef.current = []
      }

      if (isSpeech) {
        audioBufferRef.current.push(new Float32Array(float32Audio))
      }
    },
    [],
  )

  // Note: In production, this would integrate with @ricky0123/vad-web MicVAD
  // For now, providing a simple energy-based VAD placeholder
  const feedAudio = useCallback(
    (int16Audio: Int16Array) => {
      // Convert int16 to float32
      const float32 = new Float32Array(int16Audio.length)
      for (let i = 0; i < int16Audio.length; i++) {
        float32[i] = int16Audio[i] / 32768.0
      }

      // Simple energy-based VAD (placeholder for @ricky0123/vad-web)
      let energy = 0
      for (let i = 0; i < float32.length; i++) {
        energy += float32[i] * float32[i]
      }
      energy = energy / float32.length
      const isSpeech = energy > 0.001

      processSample(float32, isSpeech)
    },
    [processSample],
  )

  const markLoaded = useCallback(() => {
    setState((prev) => ({ ...prev, isLoaded: true }))
  }, [])

  return {
    ...state,
    feedAudio,
    markLoaded,
  }
}
