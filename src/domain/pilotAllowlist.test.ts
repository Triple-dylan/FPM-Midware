import { describe, expect, it } from "vitest";
import {
  buildAryeoTeamAgentHaystack,
  cohortMatchesStructuredAryeoGroup,
  pickPilotCohort,
  pickPilotCohortFromGroup,
  summarizeAryeoCustomerTeamMemberships,
  type PilotCohortConfig,
} from "./pilotAllowlist.js";

describe("pilotAllowlist", () => {
  const cohorts: PilotCohortConfig[] = [
    {
      id: "a",
      teamTag: "T:A",
      matchUserEmails: ["agent@unique-foo-team.com"],
    },
    {
      id: "b",
      teamTag: "T:B",
      matchUserEmails: ["m@y.com"],
    },
  ];

  it("structured match: connection email on owner, not client group.email", () => {
    const g = {
      object: "GROUP",
      name: "Client Office LLC",
      email: "client@wrong.com",
      owner: { first_name: "Marta", last_name: "Peralta", email: "m@y.com" },
    };
    expect(pickPilotCohortFromGroup(g, cohorts)?.id).toBe("b");
    expect(cohortMatchesStructuredAryeoGroup(g, cohorts[1])).toBe(true);
    expect(cohortMatchesStructuredAryeoGroup(g, cohorts[0])).toBe(false);
  });

  it("structured match: ignores client name-only (no connection email)", () => {
    const g = {
      name: "Marta Peralta Office",
      email: "m@y.com",
    };
    expect(pickPilotCohortFromGroup(g, cohorts)).toBeNull();
  });

  it("pickPilotCohort (haystack legacy) still works for needle-only cohorts", () => {
    const needleOnly: PilotCohortConfig[] = [{ id: "x", teamTag: "T", needles: ["alpha", "beta"] }];
    const hay = "something alpha and beta gamma";
    expect(pickPilotCohort(hay, needleOnly)?.id).toBe("x");
  });

  it("email domain on connection users only", () => {
    const jamie: PilotCohortConfig[] = [
      { id: "jamie", teamTag: "J", matchEmailDomains: ["thejamiemcmartingroup.com"] },
    ];
    const ok = {
      users: [{ email: "kara@thejamiemcmartingroup.com", full_name: "Kara Lam" }],
    };
    const wrongClientEmail = {
      email: "someone@thejamiemcmartingroup.com",
      users: [],
    };
    expect(pickPilotCohortFromGroup(ok, jamie)?.id).toBe("jamie");
    expect(pickPilotCohortFromGroup(wrongClientEmail, jamie)).toBeNull();
  });

  it("matches agent name when it appears on owner, not on client display name alone (needles)", () => {
    const cohorts2: PilotCohortConfig[] = [
      { id: "jamie", teamTag: "T:J", needles: ["Jamie McMartin"] },
    ];
    const g = {
      object: "GROUP",
      name: "McMartin, Jamie",
      email: "j@m.com",
      owner: { first_name: "Jamie", last_name: "McMartin", email: "j@m.com" },
    };
    expect(pickPilotCohortFromGroup(g, cohorts2)?.id).toBe("jamie");

    expect(
      pickPilotCohortFromGroup(
        { object: "GROUP", name: "McMartin, Jamie", email: "j@m.com" },
        cohorts2,
      ),
    ).toBeNull();
  });

  it("includes team_members in team haystack", () => {
    const h = buildAryeoTeamAgentHaystack({
      object: "GROUP",
      name: "Client",
      team_members: [{ role: "agent", full_name: "Acme Team Lead" }],
    });
    expect(h).toContain("acme");
  });

  it("includes customer_team_memberships customer_user in haystack and summary", () => {
    const group = {
      object: "GROUP",
      name: "Wrong Client",
      customer_team_memberships: [
        {
          role: "admin",
          status: "active",
          customer_user: {
            full_name: "Jordan Sales",
            email: "jordan@broker.com",
            agent_company_name: "Broker Co",
          },
          customer_team: {
            name: "Elite Team",
            brokerage_name: "Big Brokerage",
          },
        },
      ],
    };
    const h = buildAryeoTeamAgentHaystack(group);
    expect(h).toContain("jordan");
    expect(h).toContain("broker");
    expect(h).toContain("elite");
    const s = summarizeAryeoCustomerTeamMemberships(group);
    expect(s).toContain("Jordan Sales");
    expect(s).toContain("Elite Team");
  });
});
