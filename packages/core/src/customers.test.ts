import { describe, expect, test } from "vitest";
import * as customers from "./customers.js";

const minimal = { name: "Kila Trading", email: "accounts@kila.example", phone: "" };
const full = {
  ...minimal,
  ccEmails: ["boss@kila.example"],
  address: "Section 5, Lot 9, Gordons",
  tin: "500012345",
  gstNumber: "GST-1234",
  termsDays: 14,
  poRequired: true,
  notes: "Send to accounts, not the site office.",
};

describe("a customer is a tenant with optional business details", () => {
  test("a tenant as stored today reads as a customer with every extra empty", () => {
    expect(customers.customerOf(minimal)).toEqual({
      ...minimal, ccEmails: [], address: "", tin: "", gstNumber: "", termsDays: null, poRequired: false, notes: "",
    });
  });

  test("stored extras are read back", () => {
    expect(customers.customerOf(full)).toEqual(full);
  });

  test("malformed extras from stored data read as empty, not trusted", () => {
    const odd = { ...minimal, ccEmails: "boss@kila.example", termsDays: "14", poRequired: "yes", tin: 500012345 };
    expect(customers.customerOf(odd)).toMatchObject({ ccEmails: [], termsDays: null, poRequired: false, tin: "" });
  });
});

describe("what is wrong with a customer as typed", () => {
  test("a minimal or full customer is fine", () => {
    expect(customers.customerProblems(customers.customerOf(minimal))).toEqual({});
    expect(customers.customerProblems(full)).toEqual({});
  });

  test("the name and email follow the tenant rules, in neutral words", () => {
    expect(customers.customerProblems({ ...full, name: " " }).name).toBe("Enter the customer's name.");
    expect(customers.customerProblems({ ...full, email: "kila" }).email).toBe("Enter an email address like name@example.com.");
  });

  test("copy-to addresses: at most three, each a real address, none repeating the main one", () => {
    expect(customers.customerProblems({ ...full, ccEmails: ["a@x.example", "b@x.example", "c@x.example", "d@x.example"] })).toHaveProperty("ccEmails");
    expect(customers.customerProblems({ ...full, ccEmails: ["nope"] })).toHaveProperty("ccEmails");
    expect(customers.customerProblems({ ...full, ccEmails: ["ACCOUNTS@kila.example"] })).toHaveProperty("ccEmails");
  });

  test("lengths: address 200, TIN and GST number 20, notes 500; phone 30 as for tenants", () => {
    expect(customers.customerProblems({ ...full, address: "x".repeat(201) })).toHaveProperty("address");
    expect(customers.customerProblems({ ...full, tin: "1".repeat(21) })).toHaveProperty("tin");
    expect(customers.customerProblems({ ...full, gstNumber: "1".repeat(21) })).toHaveProperty("gstNumber");
    expect(customers.customerProblems({ ...full, notes: "x".repeat(501) })).toHaveProperty("notes");
    expect(customers.customerProblems({ ...full, phone: "1".repeat(31) })).toHaveProperty("phone");
  });

  test("payment terms are blank (the org's default) or 0 to 90 whole days", () => {
    expect(customers.customerProblems({ ...full, termsDays: null })).toEqual({});
    expect(customers.customerProblems({ ...full, termsDays: 0 })).toEqual({});
    for (const bad of [-1, 91, 7.5]) expect(customers.customerProblems({ ...full, termsDays: bad }), String(bad)).toHaveProperty("termsDays");
  });
});

test("the fields a customer may store, for the rules and the store to agree on", () => {
  expect(customers.CUSTOMER_EXTRAS).toEqual(["ccEmails", "address", "tin", "gstNumber", "termsDays", "poRequired", "notes"]);
});
