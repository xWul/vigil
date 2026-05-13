import { ReviewQueue } from "./features/review-queue/ReviewQueue.js";

export function App() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden" }}>
      <ReviewQueue theme="dark" />
    </div>
  );
}
