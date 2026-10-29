import { SITE } from "../lib/site";

export default function Home() {
  return (
    <main>
      <h1>{SITE.name}</h1>
      <p>{SITE.tagline}</p>
    </main>
  );
}
