import React, { useEffect, useRef } from "react";
import { ControlBar } from "./components/ControlBar";
import { HistoryPanel } from "./components/HistoryPanel";
import { TranscriptArea } from "./components/TranscriptArea";
import { RecordingControls } from "./components/RecordingControls";
import { PlaybackBar } from "./components/PlaybackBar";
import { SetupWizard } from "./components/SetupWizard";
import { SettingsModal, TabId } from "./components/SettingsModal";
import { SummaryPanel } from "./components/SummaryPanel";
import { useAppStore } from "./stores/appStore";
import { useAudioCapture } from "./hooks/useAudioCapture";
import { useVAD } from "./hooks/useVAD";
import { useTranscription } from "./hooks/useTranscription";
import { useSession } from "./hooks/useSession";
import { useAudioPlayer } from "./hooks/useAudioPlayer";
import { DownloadManagerDialog } from "./components/DownloadManagerDialog";
import { useAudioDownloads } from "./hooks/useAudioDownloads";
import { useSettings } from "./hooks/useSettings";
import { useModelDownloads } from "./hooks/useModelDownloads";
import { useTtsSettings } from "./hooks/useTtsSettings";
import { useSummary } from "./hooks/useSummary";
import { useTranslation } from "./hooks/useTranslation";
import { useSessionManagement } from "./hooks/useSessionManagement";

function App(): React.JSX.Element {
  const store = useAppStore();
  const audioCapture = useAudioCapture();
  const session = useSession();
  const audioPlayer = useAudioPlayer();

  const settings = useSettings({ store, audioCapture });
  const {
    needsSetup,
    setNeedsSetup,
    showSettings,
    setShowSettings,
    settingsInitialTab,
    setSettingsInitialTab,
    autoStartSidecar,
    configDir,
    hfMirrorUrl,
    DEFAULT_HF_URL,
    historyPanelWidth,
    summaryPanelWidth,
    isChangingDataDir,
    dataDirChangeMessage,
    dataDirChangeMessageKind,
    handleStartSidecar,
    handleStopSidecar,
    handleDeviceChange,
    handleChangeDataDir,
    handleChangeAutoStartSidecar,
    handleChangeHfMirrorUrl,
    handleHistoryWidthChange,
    handleSummaryWidthChange,
  } = settings;

  // Forward-declare ref so useAudioDownloads can call handleSelectSession
  // which is defined further down (circular dependency broken via ref)
  const handleSelectSessionRef = useRef<(id: number) => Promise<void>>(
    async () => undefined,
  );

  const audioDownloadsHook = useAudioDownloads({
    loadSessions: store.loadSessions,
    onSelectSession: (id) => handleSelectSessionRef.current(id),
    needsSetup,
  });
  const {
    showDownloadManager,
    setShowDownloadManager,
    audioDownloads,
    downloadBadge,
    handleStartAudioDownload,
    handleCancelAudioDownload,
    handleRetryAudioDownload,
    handleRemoveAudioDownload,
    handleAudioDownloadSelectSession,
  } = audioDownloadsHook;

  // Forward-declare ref for TTS model refresh (used by useModelDownloads resume)
  const refreshTtsModelsRef = useRef<() => Promise<void>>(
    async () => undefined,
  );

  const modelDownloadsHook = useModelDownloads({
    store,
    onRefreshTtsModels: () => refreshTtsModelsRef.current(),
  });
  const {
    downloads,
    setDownloads,
    isDownloading,
    downloadingModelId,
    downloadProgress,
    downloadError,
    handleDownloadModel,
    handleSelectModel,
    handleSettingsDownloadModel,
    handleDeleteModel,
    handleSearchModels,
    handlePauseDownload,
    handleResumeDownload,
    handleCancelDownload,
  } = modelDownloadsHook;

  // Ref bridges: transcription/VAD callbacks live in useSessionManagement
  // but useTranscription/useVAD must be called first (stable hook order).
  // These refs are populated after useSessionManagement returns.
  const onFinalRef = useRef<
    (text: string, segId: number, start: number, end: number) => void
  >(() => {});
  const onErrorRef = useRef<(msg: string) => void>(() => {});
  const onSpeechStartRef = useRef<() => void>(() => {});
  const onSpeechEndRef = useRef<() => void>(() => {});

  const transcription = useTranscription({
    onFinal: (...args) => onFinalRef.current(...args),
    onError: (...args) => onErrorRef.current(...args),
  });

  const vad = useVAD({
    onSpeechStart: () => onSpeechStartRef.current(),
    onSpeechEnd: () => onSpeechEndRef.current(),
  });

  const ttsSettingsHook = useTtsSettings({ store, downloads, setDownloads });
  const {
    ttsProviders,
    selectedTtsProviderId,
    ttsModels,
    selectedTtsModelId,
    selectedTtsVoice,
    ttsVoices,
    isTtsDownloading,
    ttsDownloadingModelId,
    ttsDownloadProgress,
    ttsDownloadError,
    handleSaveTtsSettings,
    handleSelectTtsModel,
    handleChangeTtsVoice,
    handleChangeTtsModelForPlay,
    handleDownloadTtsModel,
    handleDeleteTtsModel,
    handleSearchTtsModels,
  } = ttsSettingsHook;
  // Wire up refreshTtsModels for useModelDownloads resume handler
  refreshTtsModelsRef.current = ttsSettingsHook.refreshTtsModels;

  const summaryHook = useSummary({
    store: {
      currentSessionId: store.currentSessionId,
      sessions: store.sessions,
      loadSessions: store.loadSessions,
      setAsrProviders: store.setAsrProviders,
      setSelectedAsrProviderId: store.setSelectedAsrProviderId,
      setSidecarReady: store.setSidecarReady,
    },
  });
  const {
    llmProviders,
    selectedSummaryModel,
    selectedRapidModel,
    rapidRenamePrompt,
    aiRenamingSessionId,
    summaries,
    generatingTabs,
    streamingContentMap,
    generateError,
    promptTypes,
    activePromptType,
    setSummaries,
    setGenerateError,
    handleSaveLlmProviders,
    handleSaveAsrSettings,
    handleChangeSummaryModel,
    handleChangeRapidModel,
    handleChangeRapidRenamePrompt,
    handleSummarize,
    handleChangePromptType,
    handleSavePromptTypes,
    handleAiRename,
  } = summaryHook;

  const translationHook = useTranslation({
    store: {
      currentSessionId: store.currentSessionId,
      segments: store.segments,
    },
    llmProviders,
  });
  const {
    selectedTranslateModel,
    translatePrompt,
    isTranslating,
    translationProgress,
    translations,
    activeTranslationLang,
    setTranslations,
    handleTranslate,
    handleStopTranslation,
    handleLoadTranslations,
    handleChangeTranslateModel,
    handleChangeTranslatePrompt,
  } = translationHook;

  const sessionMgmt = useSessionManagement({
    store,
    session,
    audioCapture,
    audioPlayer,
    transcription,
    vad,
    summary: {
      setSummaries,
      setGenerateError,
      activePromptType,
    },
    translation: {
      activeTranslationLang,
      setTranslations,
      handleLoadTranslations,
    },
    setNeedsSetup,
  });
  const {
    regeneratingSessionId,
    regenerationProgress,
    audioLevel,
    sessionCategories,
    onFinalCallback,
    onErrorCallback,
    onSpeechStart,
    onSpeechEnd,
    handleStart,
    handleStop,
    handleWizardComplete,
    handleSelectSession,
    handlePlaySession,
    handleDeleteSession,
    handleRenameSession,
    handleUpdateCategory,
    handleReorderSessions,
    handleEditSession,
    handleAddCategory,
    handleDeleteCategory,
    handleReorderCategories,
    handleRegenerateSubtitles,
    handleCancelRegeneration,
    handleUploadAudio,
  } = sessionMgmt;

  // Populate ref bridges for transcription/VAD callbacks
  onFinalRef.current = onFinalCallback;
  onErrorRef.current = onErrorCallback;
  onSpeechStartRef.current = onSpeechStart;
  onSpeechEndRef.current = onSpeechEnd;
  handleSelectSessionRef.current = handleSelectSession;

  // Initialize app on mount
  useEffect(() => {
    const init = async (): Promise<void> => {
      try {
        const dataDir = await window.capty.getDataDir();
        if (!dataDir) {
          setNeedsSetup(true);
          return;
        }
        setNeedsSetup(false);
        store.setDataDir(dataDir);
        await store.loadSessions();
        await audioCapture.loadDevices();

        const config = await window.capty.getConfig();

        await settings.initFromConfig(config);
        await summaryHook.initFromConfig(config);
        translationHook.initFromConfig(config);
        await sessionMgmt.initFromConfig(config);
        await settings.initSidecar(config);
        await modelDownloadsHook.initModels(config);
        await ttsSettingsHook.initTts(config);
      } catch (err) {
        console.error("Init error:", err);
      }
    };
    void init();
  }, [needsSetup]); // eslint-disable-line react-hooks/exhaustive-deps

  // No streaming partial text with HTTP-based transcription

  // Show nothing while checking setup status
  if (needsSetup === null) {
    return <></>;
  }

  // Show setup wizard if dataDir is not configured
  if (needsSetup) {
    return <SetupWizard onComplete={handleWizardComplete} />;
  }

  return (
    <div
      className={store.isRecording ? "recording-mode" : ""}
      style={{ display: "flex", flexDirection: "column", height: "100vh" }}
    >
      <ControlBar
        isRecording={store.isRecording}
        sidecarReady={store.sidecarReady}
        activeProviderName={
          store.asrProviders.find((p) => p.id === store.selectedAsrProviderId)
            ?.name ?? null
        }
        isSidecarActive={
          store.asrProviders.find((p) => p.id === store.selectedAsrProviderId)
            ?.isSidecar ?? false
        }
        devices={audioCapture.devices}
        selectedDeviceId={audioCapture.selectedDeviceId}
        onDeviceChange={handleDeviceChange}
        models={store.models}
        selectedModelId={store.selectedModelId}
        onModelChange={handleSelectModel}
        onSettings={() => setShowSettings(true)}
        onOpenSettingsTab={(tab) => {
          setSettingsInitialTab(tab as TabId);
          setShowSettings(true);
        }}
        isDownloading={isDownloading}
        downloadProgress={downloadProgress}
        onDownloadModel={handleDownloadModel}
        ttsProviderReady={store.ttsProviderReady}
        ttsProviderName={
          ttsProviders.find((p) => p.id === selectedTtsProviderId)?.name ?? null
        }
        selectedTtsModelId={selectedTtsModelId}
        onStartSidecar={handleStartSidecar}
        onStopSidecar={handleStopSidecar}
        sidecarStarting={store.sidecarStarting}
        sidecarPort={store.sidecarPort}
      />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <HistoryPanel
          sessions={store.sessions}
          currentSessionId={store.currentSessionId}
          playingSessionId={audioPlayer.playingSessionId}
          regeneratingSessionId={regeneratingSessionId}
          regenerationProgress={regenerationProgress}
          isRecording={store.isRecording}
          width={historyPanelWidth}
          onWidthChange={handleHistoryWidthChange}
          onSelectSession={handleSelectSession}
          onDeleteSession={handleDeleteSession}
          onPlaySession={handlePlaySession}
          onStopPlayback={audioPlayer.stop}
          onRenameSession={handleRenameSession}
          onRegenerateSubtitles={handleRegenerateSubtitles}
          onCancelRegeneration={handleCancelRegeneration}
          onOpenFolder={(id) => window.capty.openAudioFolder(id)}
          onUploadAudio={handleUploadAudio}
          onDownloadAudio={() => setShowDownloadManager(true)}
          downloadBadge={downloadBadge}
          onAiRename={
            llmProviders.some((p) => (p.models?.length ?? 0) > 0)
              ? handleAiRename
              : undefined
          }
          aiRenamingSessionId={aiRenamingSessionId}
          onUpdateCategory={handleUpdateCategory}
          onReorderSessions={handleReorderSessions}
          categories={sessionCategories}
          onAddCategory={handleAddCategory}
          onDeleteCategory={handleDeleteCategory}
          onReorderCategories={handleReorderCategories}
          onEditSession={handleEditSession}
        />
        <TranscriptArea
          segments={store.segments}
          partialText={store.partialText}
          isRecording={store.isRecording}
          playbackTime={
            audioPlayer.playingSessionId !== null
              ? audioPlayer.currentTime
              : null
          }
          onSeekToTime={
            audioPlayer.playingSessionId !== null ? audioPlayer.seek : null
          }
          sessionId={store.currentSessionId}
          canExport={!store.isRecording && store.segments.length > 0}
          onTranslate={
            !store.isRecording &&
            store.segments.length > 0 &&
            (selectedTranslateModel ||
              llmProviders.some((p) => (p.models?.length ?? 0) > 0))
              ? handleTranslate
              : null
          }
          isTranslating={isTranslating}
          translationProgress={translationProgress}
          onStopTranslation={isTranslating ? handleStopTranslation : null}
          translations={translations}
          activeTranslationLang={activeTranslationLang}
          onLoadTranslations={
            store.currentSessionId
              ? (lang: string) =>
                  handleLoadTranslations(store.currentSessionId!, lang)
              : undefined
          }
          llmProviders={llmProviders}
          selectedTranslateModel={selectedTranslateModel}
          onChangeTranslateModel={handleChangeTranslateModel}
        />
        <SummaryPanel
          summaries={summaries}
          isGenerating={
            store.currentSessionId !== null &&
            generatingTabs.has(`${store.currentSessionId}:${activePromptType}`)
          }
          generatingPromptType={
            store.currentSessionId !== null &&
            generatingTabs.has(`${store.currentSessionId}:${activePromptType}`)
              ? activePromptType
              : null
          }
          streamingContent={
            store.currentSessionId !== null
              ? (streamingContentMap[
                  `${store.currentSessionId}:${activePromptType}`
                ] ?? "")
              : ""
          }
          generateError={generateError}
          currentSessionId={store.currentSessionId}
          hasSegments={store.segments.length > 0}
          llmProviders={llmProviders}
          selectedSummaryModel={selectedSummaryModel}
          promptTypes={promptTypes}
          activePromptType={activePromptType}
          initialWidth={summaryPanelWidth}
          ttsModels={ttsModels.filter((m) => m.downloaded)}
          selectedTtsModelId={selectedTtsModelId}
          selectedTtsVoice={selectedTtsVoice}
          ttsVoices={ttsVoices}
          ttsProviderReady={store.ttsProviderReady}
          isSidecarTts={
            ttsProviders.find((p) => p.id === selectedTtsProviderId)
              ?.isSidecar ?? false
          }
          ttsProviderName={
            ttsProviders.find((p) => p.id === selectedTtsProviderId)?.name ??
            null
          }
          ttsProviderModel={
            ttsProviders.find((p) => p.id === selectedTtsProviderId)?.model ??
            ""
          }
          ttsProviderVoice={
            ttsProviders.find((p) => p.id === selectedTtsProviderId)?.voice ??
            ""
          }
          onWidthChange={handleSummaryWidthChange}
          onSummarize={handleSummarize}
          onChangePromptType={handleChangePromptType}
          onSavePromptTypes={handleSavePromptTypes}
          onChangeTtsModel={handleChangeTtsModelForPlay}
          onChangeTtsVoice={handleChangeTtsVoice}
        />
      </div>
      {/* ── Bottom bar: crossfade between RecordingControls and PlaybackBar ── */}
      <div
        style={{
          position: "relative",
          height: "100px",
          flexShrink: 0,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            transition: "opacity 0.3s ease, transform 0.3s ease",
            opacity: audioPlayer.playingSessionId !== null ? 0 : 1,
            transform:
              audioPlayer.playingSessionId !== null
                ? "translateY(20px)"
                : "translateY(0)",
            pointerEvents:
              audioPlayer.playingSessionId !== null ? "none" : "auto",
          }}
        >
          <RecordingControls
            isRecording={store.isRecording}
            elapsedSeconds={store.elapsedSeconds}
            audioLevel={audioLevel}
            onStart={handleStart}
            onStop={handleStop}
          />
        </div>
        <div
          style={{
            position: "absolute",
            inset: 0,
            transition: "opacity 0.3s ease, transform 0.3s ease",
            opacity: audioPlayer.playingSessionId !== null ? 1 : 0,
            transform:
              audioPlayer.playingSessionId !== null
                ? "translateY(0)"
                : "translateY(20px)",
            pointerEvents:
              audioPlayer.playingSessionId !== null ? "auto" : "none",
          }}
        >
          <PlaybackBar
            isPlaying={audioPlayer.isPlaying}
            currentTime={audioPlayer.currentTime}
            duration={audioPlayer.duration}
            playbackRate={audioPlayer.playbackRate}
            audioRef={audioPlayer.audioRef}
            segments={store.segments}
            onPause={audioPlayer.pause}
            onResume={audioPlayer.resume}
            onSeek={audioPlayer.seek}
            onStop={audioPlayer.stop}
            onSkipBackward={() => audioPlayer.skipBackward(15)}
            onSkipForward={() => audioPlayer.skipForward(15)}
            onPlaybackRateChange={audioPlayer.setPlaybackRate}
          />
        </div>
      </div>
      {showSettings && (
        <SettingsModal
          dataDir={store.dataDir}
          configDir={configDir}
          models={store.models}
          selectedModelId={store.selectedModelId}
          isDownloading={isDownloading}
          downloadingModelId={downloadingModelId}
          downloadProgress={downloadProgress}
          downloadError={downloadError}
          isRecording={store.isRecording}
          hfMirrorUrl={hfMirrorUrl}
          defaultHfUrl={DEFAULT_HF_URL}
          llmProviders={llmProviders}
          asrProviders={store.asrProviders}
          selectedAsrProviderId={store.selectedAsrProviderId}
          sidecarReady={store.sidecarReady}
          downloads={downloads}
          onChangeDataDir={handleChangeDataDir}
          onSelectModel={handleSelectModel}
          onDownloadModel={handleSettingsDownloadModel}
          onDeleteModel={handleDeleteModel}
          onSearchModels={handleSearchModels}
          onChangeHfMirrorUrl={handleChangeHfMirrorUrl}
          onSaveLlmProviders={handleSaveLlmProviders}
          onSaveAsrSettings={handleSaveAsrSettings}
          onPauseDownload={handlePauseDownload}
          onResumeDownload={handleResumeDownload}
          onCancelDownload={handleCancelDownload}
          ttsProviders={ttsProviders}
          selectedTtsProviderId={selectedTtsProviderId}
          ttsModels={ttsModels}
          selectedTtsModelId={selectedTtsModelId}
          isTtsDownloading={isTtsDownloading}
          ttsDownloadingModelId={ttsDownloadingModelId}
          ttsDownloadProgress={ttsDownloadProgress}
          ttsDownloadError={ttsDownloadError}
          isChangingDataDir={isChangingDataDir}
          dataDirChangeMessage={dataDirChangeMessage}
          dataDirChangeMessageKind={dataDirChangeMessageKind}
          onSaveTtsSettings={handleSaveTtsSettings}
          onSelectTtsModel={handleSelectTtsModel}
          onDownloadTtsModel={handleDownloadTtsModel}
          onDeleteTtsModel={handleDeleteTtsModel}
          onSearchTtsModels={handleSearchTtsModels}
          selectedTtsVoice={selectedTtsVoice}
          ttsVoices={ttsVoices}
          onChangeTtsVoice={handleChangeTtsVoice}
          onChangeTtsModel={handleChangeTtsModelForPlay}
          selectedSummaryModel={selectedSummaryModel}
          onChangeSummaryModel={handleChangeSummaryModel}
          selectedRapidModel={selectedRapidModel}
          onChangeRapidModel={handleChangeRapidModel}
          rapidRenamePrompt={rapidRenamePrompt}
          onChangeRapidRenamePrompt={handleChangeRapidRenamePrompt}
          selectedTranslateModel={selectedTranslateModel}
          onChangeTranslateModel={handleChangeTranslateModel}
          translatePrompt={translatePrompt}
          onChangeTranslatePrompt={handleChangeTranslatePrompt}
          autoStartSidecar={autoStartSidecar}
          onChangeAutoStartSidecar={handleChangeAutoStartSidecar}
          initialTab={settingsInitialTab}
          onTabChange={setSettingsInitialTab}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showDownloadManager && (
        <DownloadManagerDialog
          downloads={audioDownloads}
          onStartDownload={handleStartAudioDownload}
          onCancelDownload={handleCancelAudioDownload}
          onRetryDownload={handleRetryAudioDownload}
          onRemoveDownload={handleRemoveAudioDownload}
          onSelectSession={handleAudioDownloadSelectSession}
          onClose={() => setShowDownloadManager(false)}
        />
      )}
    </div>
  );
}

export default App;
