import { ArrowLeft } from "lucide-react";
import { Eyebrow } from "../components/Primitives";

export function NotFound() {
  return <div className="app-page not-found"><Eyebrow>404 · Unknown route</Eyebrow><h1>This depth does not exist.</h1><p>The requested FirmDepth surface is unavailable. Return to the verified product overview.</p><a className="button button-dark" href="/"><ArrowLeft size={16} />Return home</a></div>;
}
