import { Dashboard } from "@/components/Dashboard";
import { FARM_SVG } from "@/generated/farm";

export default function Home() {
  // The 2 MB isometric farm is rendered once on the server; the client only toggles attributes on it.
  const farm = <div key="farm" className="iso farm" data-theme="light" data-mode="photo" dangerouslySetInnerHTML={{ __html: FARM_SVG }} />;
  return <Dashboard farm={farm} />;
}
