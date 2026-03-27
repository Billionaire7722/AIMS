import { useEffect, useRef, useState } from "react";
import { useLanguage } from "./i18n";

type Props = {
  musicXmlUrl?: string | null;
};

export function SheetViewer({ musicXmlUrl }: Props) {
  const { t } = useLanguage();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<string>(t.sheet.waitingForScore);

  useEffect(() => {
    let disposed = false;

    async function load() {
      if (!containerRef.current || !musicXmlUrl) {
        setStatus(t.sheet.waitingForScore);
        return;
      }
      setStatus(t.sheet.loadingSheetMusic);
      containerRef.current.innerHTML = "";
      const { OpenSheetMusicDisplay } = await import("opensheetmusicdisplay");
      const osmd = new OpenSheetMusicDisplay(containerRef.current, {
        autoResize: true,
        drawingParameters: "default",
      });
      try {
        await osmd.load(musicXmlUrl);
        if (!disposed) {
          osmd.render();
          setStatus("");
        }
      } catch (error) {
        if (!disposed) {
          setStatus(error instanceof Error ? error.message : t.sheet.failedToRenderScore);
        }
      }
    }

    void load();
    return () => {
      disposed = true;
    };
  }, [musicXmlUrl, t.sheet]);

  return (
    <div className="sheet-viewer">
      {status ? <div className="sheet-status">{status}</div> : null}
      <div ref={containerRef} className="sheet-canvas" />
    </div>
  );
}
