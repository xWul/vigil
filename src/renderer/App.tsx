import { useState, useEffect } from "react";

import type { ConnectedAccount } from "../shared/auth.js";
import { api } from "./api.js";
import { TOKENS, SANS } from "./shared/theme.js";
import { Auth } from "./features/auth/Auth.js";
import { ReviewQueue } from "./features/review-queue/ReviewQueue.js";

type Route =
  | { screen: "checking" }
  | { screen: "auth" }
  | { screen: "queue"; accounts: readonly ConnectedAccount[] };

function CheckingScreen() {
  const t = TOKENS.dark;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: t.bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <span
        style={{
          fontFamily: SANS,
          fontSize: 13,
          color: t.textFaint,
          letterSpacing: "-0.005em",
        }}
      >
        Loading…
      </span>
    </div>
  );
}

export function App() {
  const [route, setRoute] = useState<Route>({ screen: "checking" });

  useEffect(() => {
    async function checkAccounts() {
      const result = await api.invoke("auth:getAccounts");
      if (result.ok && result.value.length > 0) {
        setRoute({ screen: "queue", accounts: result.value });
      } else {
        setRoute({ screen: "auth" });
      }
    }
    void checkAccounts();
  }, []);

  function handleAuthenticated(accounts: readonly ConnectedAccount[]) {
    setRoute({ screen: "queue", accounts });
  }

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden" }}>
      {route.screen === "checking" && <CheckingScreen />}
      {route.screen === "auth" && <Auth onAuthenticated={handleAuthenticated} />}
      {route.screen === "queue" && <ReviewQueue theme="dark" />}
    </div>
  );
}
