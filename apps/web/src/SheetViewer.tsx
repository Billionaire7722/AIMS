import { useEffect, useRef, useState } from "react";

type Props = {
  musicXmlUrl?: string | null;
};

export function SheetViewer({ musicXmlUrl }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<string>("Waiting for a score.");

  useEffect(() => {
    let disposed = false;

    async function load() {
      if (!containerRef.current || !musicXmlUrl) {
        setStatus("Waiting for a score.");
        return;
      }
      setStatus("Loading sheet music...");
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
          setStatus(error instanceof Error ? error.message : "Failed to render score.");
        }
      }
    }

    void load();
    return () => {
      disposed = true;
    };
  }, [musicXmlUrl]);

  return (
    <div className="sheet-viewer">
      {status ? <div className="sheet-status">{status}</div> : null}
      <div ref={containerRef} className="sheet-canvas" />
    </div>
  );
}
