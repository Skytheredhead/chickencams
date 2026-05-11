export default function PrinterView() {
  return (
    <div className="h-[calc(100vh-env(safe-area-inset-bottom))] md:h-screen flex flex-col">
      <iframe
        src="https://printer.skylarenns.com/"
        className="flex-1 w-full border-0"
        title="Fluidd"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
