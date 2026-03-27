import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  OutputMode,
  ScoreHand,
  ScoreNote,
  ScoreSource,
  ScoreVariant,
  TranscriptionStatus,
  ScoreMeasure,
} from "@aims/shared-types";
import type { AccidentalPreference, DurationValue, Tool } from "./scoreEditorUtils";

export type Language = "vi" | "en";
export type SaveState = "idle" | "saving" | "saved" | "error";
export type PlaybackStateLabel = "playing" | "paused" | "stopped";
export type Notice =
  | { key: keyof Translation["messages"]; values?: Record<string, string | number> }
  | { raw: string };
type MessageTemplate = string | ((values?: Record<string, string | number>) => string);

export type Translation = {
  common: {
    languageLabel: string;
    languageOptions: Record<Language, string>;
    status: string;
    tempo: string;
    range: string;
    notes: string;
    ready: string;
    pending: string;
    saving: string;
    processing: string;
    saved: string;
  };
  app: {
    eyebrow: string;
    title: string;
    lede: string;
    uploadHeading: string;
    projectIdLabel: string;
    projectIdPlaceholder: string;
    fileLabel: string;
    transcriptionModeLabel: string;
    apiHintLabel: string;
    startButton: string;
    processingButton: string;
    workspaceHeading: string;
    workspaceDescription: string;
    editorReadyBadge: string;
    loadingEditorBadge: string;
    noScoreLoadedHeading: string;
    waitingForTranscriptionHeading: string;
    waitingForTranscriptionBody: string;
    analysisHeading: string;
    ratingLabel: string;
    commentLabel: string;
    commentPlaceholder: string;
    saveFeedbackButton: string;
    repeatedSectionsHeading: string;
    benchmarkHeading: string;
    noRepeatedSections: string;
  };
  jobs: {
    noJob: string;
    statusLabels: Record<TranscriptionStatus, string>;
    stageLabel: string;
  };
  outputModes: Record<OutputMode, string>;
  outputModeDescriptions: Record<OutputMode, string>;
  durations: Record<DurationValue, string>;
  hands: Record<ScoreHand, string>;
  accidentals: Record<AccidentalPreference, string>;
  sources: Record<ScoreSource, string>;
  variants: Record<ScoreVariant, string>;
  saveStates: Record<SaveState, string>;
  playbackStates: Record<PlaybackStateLabel, string>;
  measure: {
    label: string;
    rangeLabel: (start: number, end: number) => string;
    progressLabel: (current: number, total: number) => string;
    ariaLabel: (measureNumber: number) => string;
    staffLabels: Record<ScoreHand, string>;
    barlineLabels: Record<ScoreMeasure["barline"], string>;
  };
  editor: {
    eyebrow: string;
    title: string;
    aiResultLabel: string;
    notesLabel: string;
    noteToolsHeading: string;
    selectTool: string;
    noteInsertion: string;
    restInsertion: string;
    deleteTool: string;
    accidentalsHeading: string;
    tiesAndChordsHeading: string;
    toggleTieStart: string;
    toggleTieStop: string;
    mergeChord: string;
    splitChord: string;
    moveToHand: (hand: ScoreHand) => string;
    selectedNoteHeading: string;
    noNoteSelected: string;
    sourceLabel: string;
    confidenceLabel: string;
    pitchLabel: string;
    durationLabel: string;
    applyButton: string;
    longerButton: string;
    shorterButton: string;
    pitchUp: string;
    pitchDown: string;
    deleteSelected: string;
    timeSignatureLabel: string;
    keySignatureLabel: string;
    tempoLabel: string;
    addMeasure: string;
    duplicateMeasure: string;
    setRepeatStart: string;
    clearRepeatStart: string;
    setRepeatEnd: string;
    clearRepeatEnd: string;
    previousMeasure: string;
    nextMeasure: string;
    insertHand: (hand: ScoreHand) => string;
    loopCurrentMeasure: string;
    loopSelection: string;
    selectionRangeHint: string;
    selectionAnchorHint: string;
    saveStatusReady: string;
    saveStatusUnsaved: string;
    saveStatusSaving: string;
    saveStatusSaved: string;
    saveEditedScore: string;
    transportPlay: string;
    transportPause: string;
    transportResume: string;
    transportStop: string;
    transportTempoLabel: string;
    transportMetronome: string;
    transportPianoSound: string;
    transportReadout: (beat: number, measure: number) => string;
    transportPlaying: string;
    transportPaused: string;
    transportStopped: string;
    editedExportHeading: string;
    editedExportHint: string;
    noEditedExport: string;
    aiDraftAssetsHeading: string;
    aiDraftAssetsHint: string;
    shortcutsHeading: string;
    shortcuts: string[];
    summaryLabels: {
      aiResult: string;
      range: string;
      notes: string;
    };
  };
  sheet: {
    waitingForScore: string;
    loadingSheetMusic: string;
    failedToRenderScore: string;
  };
  messages: {
    chooseFileFirst: MessageTemplate;
    uploadingFile: MessageTemplate;
    jobQueued: MessageTemplate;
    transcriptionFinished: MessageTemplate;
    transcriptionFailed: MessageTemplate;
    feedbackSaved: MessageTemplate;
    failedToSaveFeedback: MessageTemplate;
    savingEditedScore: MessageTemplate;
    editedScoreSaved: MessageTemplate;
    failedToSaveEditedScore: MessageTemplate;
    invalidPitch: MessageTemplate;
    failedToPollJobStatus: MessageTemplate;
    uploadFailed: MessageTemplate;
  };
};

const STORAGE_KEY = "aims-language";

function makeEnglishTranslations(): Translation {
  return {
    common: {
      languageLabel: "Language",
      languageOptions: { vi: "Vietnamese", en: "English" },
      status: "Status",
      tempo: "Tempo",
      range: "Range",
      notes: "Notes",
      ready: "Ready",
      pending: "Pending",
      saving: "Saving...",
      processing: "Processing...",
      saved: "Saved",
    },
    app: {
      eyebrow: "AIMS piano transcription",
      title: "Correct the AI draft directly in the browser.",
      lede:
        "Upload audio, run transcription, then edit the resulting piano score inside a lightweight correction workspace. The AI result stays visible as a draft, while the edited version saves and exports separately.",
      uploadHeading: "Upload",
      projectIdLabel: "Project ID",
      projectIdPlaceholder: "Optional existing project id, or leave blank",
      fileLabel: "File",
      transcriptionModeLabel: "Transcription mode",
      apiHintLabel: "API:",
      startButton: "Start transcription",
      processingButton: "Processing...",
      workspaceHeading: "Editor workspace",
      workspaceDescription:
        "The draft score, playback, and export flow live here once transcription completes.",
      editorReadyBadge: "Editor ready",
      loadingEditorBadge: "Loading editor",
      noScoreLoadedHeading: "No score loaded yet",
      waitingForTranscriptionHeading: "Waiting for transcription",
      waitingForTranscriptionBody:
        "When the job completes, the app will fetch the editable score model and open the correction workspace here.",
      analysisHeading: "Analysis feedback",
      ratingLabel: "Rating",
      commentLabel: "Comment",
      commentPlaceholder: "What should be improved?",
      saveFeedbackButton: "Save feedback",
      repeatedSectionsHeading: "Repeated sections",
      benchmarkHeading: "Benchmark",
      noRepeatedSections: "No repeated sections detected.",
    },
    jobs: {
      noJob: "No transcription running yet.",
      statusLabels: {
        queued: "Queued",
        processing: "Processing",
        completed: "Completed",
        failed: "Failed",
      },
      stageLabel: "Stage:",
    },
    outputModes: {
      "study-friendly": "Study-friendly notation",
      original: "Raw transcription (debug)",
    },
    outputModeDescriptions: {
      "study-friendly": "Cleaner piano-facing notation with a practical correction workflow.",
      original: "Diagnostic reduction of the raw transcription. Useful for debugging, not polished study notation.",
    },
    durations: {
      4: "Whole",
      2: "Half",
      1: "Quarter",
      0.5: "Eighth",
      0.25: "16th",
    },
    hands: {
      rh: "RH",
      lh: "LH",
    },
    accidentals: {
      natural: "Natural",
      sharp: "Sharp",
      flat: "Flat",
    },
    sources: {
      ai: "AI draft",
      user: "User edit",
    },
    variants: {
      "ai-draft": "AI draft",
      "user-edited": "User edited",
      "final-export": "Final export",
    },
    saveStates: {
      idle: "Ready",
      saving: "Saving...",
      saved: "Saved",
      error: "Error",
    },
    playbackStates: {
      playing: "Playing",
      paused: "Paused",
      stopped: "Stopped",
    },
    measure: {
      label: "Measure",
      rangeLabel: (start, end) => (start === end ? `m.${start}` : `m.${start} - m.${end}`),
      progressLabel: (current, total) => `Measure ${current}/${total}`,
      ariaLabel: (measureNumber) => `Piano grand staff for measure ${measureNumber}`,
      staffLabels: {
        rh: "Treble",
        lh: "Bass",
      },
      barlineLabels: {
        single: "single",
        double: "double",
        "repeat-start": "repeat start",
        "repeat-end": "repeat end",
      },
    },
    editor: {
      eyebrow: "Editable score",
      title: "Correction workspace",
      aiResultLabel: "AI result",
      notesLabel: "Notes",
      noteToolsHeading: "Note tools",
      selectTool: "Select",
      noteInsertion: "Note insertion",
      restInsertion: "Rest insertion",
      deleteTool: "Delete",
      accidentalsHeading: "Accidentals",
      tiesAndChordsHeading: "Ties and chords",
      toggleTieStart: "Toggle tie start",
      toggleTieStop: "Toggle tie stop",
      mergeChord: "Merge chord",
      splitChord: "Split chord",
      moveToHand: (hand) => (hand === "rh" ? "Move to LH" : "Move to RH"),
      selectedNoteHeading: "Selected note",
      noNoteSelected: "No note selected.",
      sourceLabel: "Source",
      confidenceLabel: "Confidence",
      pitchLabel: "Pitch",
      durationLabel: "Duration",
      applyButton: "Apply",
      longerButton: "Longer",
      shorterButton: "Shorter",
      pitchUp: "Pitch up",
      pitchDown: "Pitch down",
      deleteSelected: "Delete selected",
      timeSignatureLabel: "Time signature",
      keySignatureLabel: "Key signature",
      tempoLabel: "Tempo",
      addMeasure: "Add measure",
      duplicateMeasure: "Duplicate measure",
      setRepeatStart: "Set repeat start",
      clearRepeatStart: "Clear repeat start",
      setRepeatEnd: "Set repeat end",
      clearRepeatEnd: "Clear repeat end",
      previousMeasure: "Previous measure",
      nextMeasure: "Next measure",
      insertHand: (hand) => (hand === "rh" ? "Insert RH" : "Insert LH"),
      loopCurrentMeasure: "Loop current measure",
      loopSelection: "Loop selection",
      selectionRangeHint: "Shift-click measure headers to create a loop range.",
      selectionAnchorHint: "Selection anchor set for looping.",
      saveStatusReady: "Ready",
      saveStatusUnsaved: "Unsaved edits",
      saveStatusSaving: "Saving...",
      saveStatusSaved: "Saved",
      saveEditedScore: "Save edited score",
      transportPlay: "Play",
      transportPause: "Pause",
      transportResume: "Resume",
      transportStop: "Stop",
      transportTempoLabel: "Tempo",
      transportMetronome: "Metronome",
      transportPianoSound: "Piano sound",
      transportReadout: (beat, measure) => `Beat ${beat.toFixed(2)} | Measure ${measure}`,
      transportPlaying: "Playing",
      transportPaused: "Paused",
      transportStopped: "Stopped",
      editedExportHeading: "Edited export",
      editedExportHint: "Save regenerates MusicXML and MIDI from the internal editable score model.",
      noEditedExport: "No edited export yet. Save the score to generate files.",
      aiDraftAssetsHeading: "AI draft assets",
      aiDraftAssetsHint: "The draft transcription remains available separately from the edited version.",
      shortcutsHeading: "Shortcuts",
      shortcuts: [
        "Cmd/Ctrl+S save",
        "Cmd/Ctrl+Z undo",
        "Cmd/Ctrl+Shift+Z redo",
        "Arrow keys change pitch or duration",
        "N note, R rest, D delete",
        "Space play or pause",
      ],
      summaryLabels: {
        aiResult: "AI result",
        range: "Range",
        notes: "Notes",
      },
    },
    sheet: {
      waitingForScore: "Waiting for a score.",
      loadingSheetMusic: "Loading sheet music...",
      failedToRenderScore: "Failed to render score.",
    },
    messages: {
      chooseFileFirst: "Choose an MP3 or MP4 file first.",
      uploadingFile: (values) => `Uploaded ${String(values?.fileName ?? "")}. Creating transcription job...`,
      jobQueued: (values) => `Job ${String(values?.jobId ?? "")} queued.`,
      transcriptionFinished: "Transcription finished. The draft score is ready to edit.",
      transcriptionFailed: "Transcription failed.",
      feedbackSaved: "Feedback saved.",
      failedToSaveFeedback: "Failed to save feedback.",
      savingEditedScore: "Saving edited score...",
      editedScoreSaved: "Edited score saved and exports refreshed.",
      failedToSaveEditedScore: "Failed to save edited score.",
      invalidPitch: "Enter a valid scientific pitch like C#4.",
      failedToPollJobStatus: "Failed to poll job status.",
      uploadFailed: "Upload failed.",
    },
  };
}

function makeVietnameseTranslations(): Translation {
  return {
    common: {
      languageLabel: "Ngôn ngữ",
      languageOptions: { vi: "Tiếng Việt", en: "English" },
      status: "Trạng thái",
      tempo: "Tempo",
      range: "Quãng âm",
      notes: "Số nốt",
      ready: "Sẵn sàng",
      pending: "Đang chờ",
      saving: "Đang lưu...",
      processing: "Đang xử lý...",
      saved: "Đã lưu",
    },
    app: {
      eyebrow: "Chuyển âm piano AIMS",
      title: "Sửa bản nháp AI ngay trong trình duyệt.",
      lede:
        "Tải âm thanh lên, chạy chuyển âm, rồi chỉnh trực tiếp bản nhạc piano trong một không gian hiệu chỉnh gọn nhẹ. Kết quả AI luôn hiển thị như bản nháp, còn bản đã sửa sẽ được lưu và xuất riêng.",
      uploadHeading: "Tải lên",
      projectIdLabel: "Mã dự án",
      projectIdPlaceholder: "Mã dự án hiện có (không bắt buộc)",
      fileLabel: "Tệp",
      transcriptionModeLabel: "Chế độ chuyển âm",
      apiHintLabel: "API:",
      startButton: "Bắt đầu chuyển âm",
      processingButton: "Đang xử lý...",
      workspaceHeading: "Không gian chỉnh sửa",
      workspaceDescription:
        "Bản nháp, phát lại, và luồng xuất sẽ hiện ở đây sau khi chuyển âm xong.",
      editorReadyBadge: "Sẵn sàng chỉnh sửa",
      loadingEditorBadge: "Đang tải trình chỉnh sửa",
      noScoreLoadedHeading: "Chưa có bản nhạc",
      waitingForTranscriptionHeading: "Đang chờ chuyển âm",
      waitingForTranscriptionBody:
        "Khi tác vụ hoàn tất, ứng dụng sẽ tải mô hình bản nhạc có thể chỉnh sửa vào đây.",
      analysisHeading: "Phản hồi phân tích",
      ratingLabel: "Đánh giá",
      commentLabel: "Bình luận",
      commentPlaceholder: "Bạn muốn cải thiện điều gì?",
      saveFeedbackButton: "Lưu phản hồi",
      repeatedSectionsHeading: "Đoạn lặp",
      benchmarkHeading: "Benchmark",
      noRepeatedSections: "Không phát hiện đoạn lặp.",
    },
    jobs: {
      noJob: "Chưa có tác vụ chuyển âm.",
      statusLabels: {
        queued: "Đang chờ",
        processing: "Đang xử lý",
        completed: "Hoàn thành",
        failed: "Thất bại",
      },
      stageLabel: "Giai đoạn:",
    },
    outputModes: {
      "study-friendly": "Ký âm luyện tập",
      original: "Bản chuyển âm thô (gỡ lỗi)",
    },
    outputModeDescriptions: {
      "study-friendly": "Bản ký âm gọn hơn, phù hợp để chỉnh sửa piano nhanh.",
      original: "Bản giảm thô của kết quả AI, hữu ích khi gỡ lỗi nhưng chưa phải bản ký âm để học.",
    },
    durations: {
      4: "Nốt tròn",
      2: "Nốt trắng",
      1: "Nốt đen",
      0.5: "Móc đơn",
      0.25: "Móc kép",
    },
    hands: {
      rh: "Tay phải",
      lh: "Tay trái",
    },
    accidentals: {
      natural: "Tự nhiên",
      sharp: "Thăng",
      flat: "Giáng",
    },
    sources: {
      ai: "Bản nháp AI",
      user: "Người dùng chỉnh sửa",
    },
    variants: {
      "ai-draft": "Bản nháp AI",
      "user-edited": "Bản đã chỉnh sửa",
      "final-export": "Bản xuất cuối",
    },
    saveStates: {
      idle: "Sẵn sàng",
      saving: "Đang lưu...",
      saved: "Đã lưu",
      error: "Lỗi",
    },
    playbackStates: {
      playing: "Đang phát",
      paused: "Đã tạm dừng",
      stopped: "Đã dừng",
    },
    measure: {
      label: "Ô nhịp",
      rangeLabel: (start, end) => (start === end ? `Ô ${start}` : `Ô ${start} - ${end}`),
      progressLabel: (current, total) => `Ô ${current}/${total}`,
      ariaLabel: (measureNumber) => `Khuông piano cho ô ${measureNumber}`,
      staffLabels: {
        rh: "Khóa Sol",
        lh: "Khóa Fa",
      },
      barlineLabels: {
        single: "đơn",
        double: "đôi",
        "repeat-start": "bắt đầu lặp",
        "repeat-end": "kết thúc lặp",
      },
    },
    editor: {
      eyebrow: "Bản nhạc có thể chỉnh sửa",
      title: "Không gian hiệu chỉnh",
      aiResultLabel: "Kết quả AI",
      notesLabel: "Số nốt",
      noteToolsHeading: "Công cụ nốt",
      selectTool: "Chọn",
      noteInsertion: "Chèn nốt",
      restInsertion: "Chèn nghỉ",
      deleteTool: "Xóa",
      accidentalsHeading: "Dấu hóa",
      tiesAndChordsHeading: "Nối và hợp âm",
      toggleTieStart: "Bật/tắt tie đầu",
      toggleTieStop: "Bật/tắt tie cuối",
      mergeChord: "Gộp hợp âm",
      splitChord: "Tách hợp âm",
      moveToHand: (hand) => (hand === "rh" ? "Chuyển sang tay trái" : "Chuyển sang tay phải"),
      selectedNoteHeading: "Nốt đã chọn",
      noNoteSelected: "Chưa chọn nốt nào.",
      sourceLabel: "Nguồn",
      confidenceLabel: "Độ tin cậy",
      pitchLabel: "Cao độ",
      durationLabel: "Trường độ",
      applyButton: "Áp dụng",
      longerButton: "Dài hơn",
      shorterButton: "Ngắn hơn",
      pitchUp: "Tăng cao độ",
      pitchDown: "Giảm cao độ",
      deleteSelected: "Xóa nốt đã chọn",
      timeSignatureLabel: "Nhịp",
      keySignatureLabel: "Hóa biểu",
      tempoLabel: "Tempo",
      addMeasure: "Thêm ô nhịp",
      duplicateMeasure: "Nhân đôi ô nhịp",
      setRepeatStart: "Đặt điểm lặp đầu",
      clearRepeatStart: "Xóa điểm lặp đầu",
      setRepeatEnd: "Đặt điểm lặp cuối",
      clearRepeatEnd: "Xóa điểm lặp cuối",
      previousMeasure: "Ô trước",
      nextMeasure: "Ô sau",
      insertHand: (hand) => (hand === "rh" ? "Chèn vào tay phải" : "Chèn vào tay trái"),
      loopCurrentMeasure: "Lặp ô hiện tại",
      loopSelection: "Lặp vùng chọn",
      selectionRangeHint: "Shift-click tiêu đề ô nhịp để tạo vùng lặp.",
      selectionAnchorHint: "Đã đặt mốc vùng chọn để lặp.",
      saveStatusReady: "Sẵn sàng",
      saveStatusUnsaved: "Chưa lưu thay đổi",
      saveStatusSaving: "Đang lưu...",
      saveStatusSaved: "Đã lưu",
      saveEditedScore: "Lưu bản nhạc đã chỉnh sửa",
      transportPlay: "Phát",
      transportPause: "Tạm dừng",
      transportResume: "Tiếp tục",
      transportStop: "Dừng",
      transportTempoLabel: "Tempo",
      transportMetronome: "Máy đếm nhịp",
      transportPianoSound: "Âm thanh piano",
      transportReadout: (beat, measure) => `Nhịp ${beat.toFixed(2)} | Ô ${measure}`,
      transportPlaying: "Đang phát",
      transportPaused: "Đã tạm dừng",
      transportStopped: "Đã dừng",
      editedExportHeading: "Xuất đã chỉnh sửa",
      editedExportHint: "Lưu sẽ tạo lại MusicXML và MIDI từ mô hình bản nhạc nội bộ.",
      noEditedExport: "Chưa có bản xuất đã chỉnh sửa. Hãy lưu bản nhạc để tạo tệp.",
      aiDraftAssetsHeading: "Tài sản bản nháp AI",
      aiDraftAssetsHint: "Bản chuyển âm nháp vẫn được giữ riêng với bản đã chỉnh sửa.",
      shortcutsHeading: "Phím tắt",
      shortcuts: [
        "Cmd/Ctrl+S lưu",
        "Cmd/Ctrl+Z hoàn tác",
        "Cmd/Ctrl+Shift+Z làm lại",
        "Phím mũi tên đổi cao độ hoặc trường độ",
        "N nốt, R nghỉ, D xóa",
        "Space phát hoặc tạm dừng",
      ],
      summaryLabels: {
        aiResult: "Kết quả AI",
        range: "Quãng âm",
        notes: "Số nốt",
      },
    },
    sheet: {
      waitingForScore: "Đang chờ bản nhạc.",
      loadingSheetMusic: "Đang tải bản nhạc...",
      failedToRenderScore: "Không thể hiển thị bản nhạc.",
    },
    messages: {
      chooseFileFirst: "Hãy chọn tệp MP3 hoặc MP4 trước.",
      uploadingFile: (values) => `Đã tải ${String(values?.fileName ?? "")}. Đang tạo tác vụ chuyển âm...`,
      jobQueued: (values) => `Tác vụ ${String(values?.jobId ?? "")} đã được xếp hàng.`,
      transcriptionFinished: "Chuyển âm hoàn tất. Bản nháp đã sẵn sàng để chỉnh sửa.",
      transcriptionFailed: "Chuyển âm thất bại.",
      feedbackSaved: "Đã lưu phản hồi.",
      failedToSaveFeedback: "Không thể lưu phản hồi.",
      savingEditedScore: "Đang lưu bản nhạc đã chỉnh sửa...",
      editedScoreSaved: "Đã lưu bản nhạc đã chỉnh sửa và cập nhật bản xuất.",
      failedToSaveEditedScore: "Không thể lưu bản nhạc đã chỉnh sửa.",
      invalidPitch: "Hãy nhập cao độ khoa học hợp lệ như C#4.",
      failedToPollJobStatus: "Không thể tải trạng thái tác vụ.",
      uploadFailed: "Tải lên thất bại.",
    },
  };
}

const translations: Record<Language, Translation> = {
  vi: makeVietnameseTranslations(),
  en: makeEnglishTranslations(),
};

type I18nContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Translation;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    if (typeof window === "undefined") {
      return "vi";
    }
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "en" || stored === "vi" ? stored : "vi";
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage,
      t: translations[language],
    }),
    [language],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useLanguage() {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useLanguage must be used within a LanguageProvider.");
  }
  return value;
}

export function noticeText(notice: Notice | null, t: Translation) {
  if (!notice) {
    return null;
  }
  if ("raw" in notice) {
    return notice.raw;
  }
  const template = t.messages[notice.key];
  return typeof template === "function" ? template(notice.values) : template;
}
