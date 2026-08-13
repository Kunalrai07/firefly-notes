import "./styles.css";
export const metadata = { title: "Firefly Notes", description: "Meeting intelligence workspace" };
export default function Layout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
