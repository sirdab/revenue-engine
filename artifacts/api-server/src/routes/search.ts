import { Router, type IRouter } from "express";
import { SearchQueryParams, SearchResponse } from "@workspace/api-zod";
import { globalSearch } from "../lib/search";

const router: IRouter = Router();

router.get("/search", async (req, res): Promise<void> => {
  const parsed = SearchQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const term = parsed.data.q.trim();
  if (!term) {
    res.json(SearchResponse.parse({ query: "", total: 0, groups: [] }));
    return;
  }

  const results = await globalSearch(term, parsed.data.types);
  res.json(SearchResponse.parse(results));
});

export default router;
