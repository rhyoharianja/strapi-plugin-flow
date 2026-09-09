import { Page } from "@strapi/strapi/admin";
import { Routes, Route } from "react-router-dom";

import { FlowPage } from "./FlowPage";
import { HomePage } from "./HomePage";

/**
 * The list and the editor are separate routes.
 *
 * `new` is declared before `:documentId` so it is matched as a mode rather than as the id of
 * a flow called "new" — react-router prefers the static segment, but stating the order makes
 * the intent obvious to the next reader.
 */
const App = () => {
  return (
    <Routes>
      <Route index element={<HomePage />} />
      <Route path="new" element={<FlowPage />} />
      <Route path=":documentId" element={<FlowPage />} />
      <Route path="*" element={<Page.Error />} />
    </Routes>
  );
};

export default App;
