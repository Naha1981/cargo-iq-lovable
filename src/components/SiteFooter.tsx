export function SiteFooter() {
  return (
    <footer className="border-t py-8">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-5 text-xs text-muted-foreground sm:px-8">
        <a href="/privacy" className="hover:text-foreground">
          Privacy
        </a>
        <a href="/terms" className="hover:text-foreground">
          Terms
        </a>
        <a href="mailto:sales@nahalabs.co.za" className="hover:text-foreground">
          Contact: sales@nahalabs.co.za
        </a>
        <span className="sm:ml-auto">Built by NahaLabs</span>
      </div>
    </footer>
  );
}
