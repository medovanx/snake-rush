import { redirect } from "next/navigation";

type HomePageProps = {
  searchParams?: Promise<{ room?: string | string[] }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const roomParam = params?.room;
  const room = Array.isArray(roomParam) ? roomParam[0] : roomParam;
  if (room) {
    redirect(`/play?room=${encodeURIComponent(room)}`);
  }

  return (
    <main className="terminal-dashboard minimal-dashboard">
      <section className="terminal-panel minimal-hero">
        <div className="minimal-copy">
          <p className="panel-kicker">Snake Rush</p>
          <h1 className="minimal-title">Fast rooms. Clean matches.</h1>
          <p className="minimal-text">Create a room, share a link, and play instantly in solo or multiplayer.</p>
        </div>
      </section>
    </main>
  );
}
