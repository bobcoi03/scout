import { describe, expect, it } from "vitest";

import { displayProjectName } from "@/lib/project-name";

describe("displayProjectName", () => {
  it("turns identifier-style underscores into readable spaces", () => {
    expect(displayProjectName("cursor_origin_code_hosting")).toBe("cursor origin code hosting");
  });

  it("leaves normal project names unchanged", () => {
    expect(displayProjectName("opensandbox-group/opensandbox")).toBe("opensandbox-group/opensandbox");
  });
});
