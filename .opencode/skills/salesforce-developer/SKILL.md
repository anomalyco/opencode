---
name: salesforce-developer
description: Writes and debugs Apex code, builds Lightning Web Components, optimizes SOQL queries, implements triggers, batch jobs, platform events, and integrations on the Salesforce platform. Use when developing Salesforce applications, customizing CRM workflows, managing governor limits, bulk processing, or setting up Salesforce DX and CI/CD pipelines.
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: platform
  triggers: Salesforce, Apex, Lightning Web Components, LWC, SOQL, SOSL, Visualforce, Salesforce DX, governor limits, triggers, platform events, CRM integration, Sales Cloud, Service Cloud
  role: expert
  scope: implementation
  output-format: code
  related-skills: api-designer, java-architect, cloud-architect, devops-engineer
---

# Salesforce Developer

## Core Workflow

1. **Analyze requirements** - Understand business needs, data model, governor limits, scalability
2. **Design solution** - Choose declarative vs programmatic, plan bulkification, design integrations
3. **Implement** - Write Apex classes, LWC components, SOQL queries with best practices
4. **Validate governor limits** - Verify SOQL/DML counts, heap size, and CPU time stay within platform limits before proceeding
5. **Test thoroughly** - Write test classes with 90%+ coverage, test bulk scenarios (200-record batches)
6. **Deploy** - Use Salesforce DX, scratch orgs, CI/CD for metadata deployment

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Apex Development | `references/apex-development.md` | Classes, triggers, async patterns, batch processing |
| Lightning Web Components | `references/lightning-web-components.md` | LWC framework, component design, events, wire service |
| SOQL/SOSL | `references/soql-sosl.md` | Query optimization, relationships, governor limits |
| Integration Patterns | `references/integration-patterns.md` | REST/SOAP APIs, platform events, external services |
| Deployment & DevOps | `references/deployment-devops.md` | Salesforce DX, CI/CD, scratch orgs, metadata API |

## Constraints

### MUST DO
- Bulkify Apex code — collect IDs/records before loops, query/DML outside loops
- Write test classes with minimum 90% code coverage, including bulk scenarios
- Use selective SOQL queries with indexed fields; leverage relationship queries
- Use appropriate async processing (batch, queueable, future) for long-running work
- Implement proper error handling and logging; use `Database.update(scope, false)` for partial success
- Use Salesforce DX for source-driven development and metadata deployment

### MUST NOT DO
- Execute SOQL/DML inside loops (governor limit violation — see bulkified trigger pattern below)
- Hard-code IDs or credentials in code
- Create recursive triggers without safeguards
- Skip field-level security and sharing rules checks
- Use deprecated Salesforce APIs or components

## Code Patterns

### Bulkified Trigger (Correct Pattern)

```apex
// CORRECT: collect IDs, query once outside the loop
trigger AccountTrigger on Account (before insert, before update) {
    AccountTriggerHandler.handleBeforeInsert(Trigger.new);
}

public class AccountTriggerHandler {
    public static void handleBeforeInsert(List<Account> newAccounts) {
        Set<Id> parentIds = new Set<Id>();
        for (Account acc : newAccounts) {
            if (acc.ParentId != null) parentIds.add(acc.ParentId);
        }
        Map<Id, Account> parentMap = new Map<Id, Account>(
            [SELECT Id, Name FROM Account WHERE Id IN :parentIds]
        );
        for (Account acc : newAccounts) {
            if (acc.ParentId != null && parentMap.containsKey(acc.ParentId)) {
                acc.Description = 'Child of: ' + parentMap.get(acc.ParentId).Name;
            }
        }
    }
}
```

```apex
// INCORRECT: SOQL inside loop — governor limit violation
trigger AccountTrigger on Account (before insert) {
    for (Account acc : Trigger.new) {
        Account parent = [SELECT Id, Name FROM Account WHERE Id = :acc.ParentId]; // BAD
        acc.Description = 'Child of: ' + parent.Name;
    }
}
```

### Batch Apex

```apex
public class ContactBatchUpdate implements Database.Batchable<SObject> {
    public Database.QueryLocator start(Database.BatchableContext bc) {
        return Database.getQueryLocator([SELECT Id, Email FROM Contact WHERE Email = null]);
    }
    public void execute(Database.BatchableContext bc, List<Contact> scope) {
        for (Contact c : scope) {
            c.Email = 'unknown@example.com';
        }
        Database.update(scope, false); // partial success allowed
    }
    public void finish(Database.BatchableContext bc) {
        // Send notification or chain next batch
    }
}
// Execute: Database.executeBatch(new ContactBatchUpdate(), 200);
```

### Test Class

```apex
@IsTest
private class AccountTriggerHandlerTest {
    @TestSetup
    static void makeData() {
        Account parent = new Account(Name = 'Parent Co');
        insert parent;
        Account child = new Account(Name = 'Child Co', ParentId = parent.Id);
        insert child;
    }

    @IsTest
    static void testBulkInsert() {
        Account parent = [SELECT Id FROM Account WHERE Name = 'Parent Co' LIMIT 1];
        List<Account> children = new List<Account>();
        for (Integer i = 0; i < 200; i++) {
            children.add(new Account(Name = 'Child ' + i, ParentId = parent.Id));
        }
        Test.startTest();
        insert children;
        Test.stopTest();

        List<Account> updated = [SELECT Description FROM Account WHERE ParentId = :parent.Id];
        System.assert(!updated.isEmpty(), 'Children should have descriptions set');
        System.assert(updated[0].Description.startsWith('Child of:'), 'Description format mismatch');
    }
}
```

### SOQL Best Practices

```apex
// Selective query — use indexed fields in WHERE clause
List<Opportunity> opps = [
    SELECT Id, Name, Amount, StageName
    FROM Opportunity
    WHERE AccountId IN :accountIds      // indexed field
      AND CloseDate >= :Date.today()    // indexed field
    ORDER BY CloseDate ASC
    LIMIT 200
];

// Relationship query to avoid extra round-trips
List<Account> accounts = [
    SELECT Id, Name,
           (SELECT Id, LastName, Email FROM Contacts WHERE Email != null)
    FROM Account
    WHERE Id IN :accountIds
];
```

### Lightning Web Component (Counter Example)

```html
<!-- counterComponent.html -->
<template>
    <lightning-card title="Counter">
        <div class="slds-p-around_medium">
            <p>Count: {count}</p>
            <lightning-button label="Increment" onclick={handleIncrement}></lightning-button>
        </div>
    </lightning-card>
</template>
```

```javascript
// counterComponent.js
import { LightningElement, track } from 'lwc';
export default class CounterComponent extends LightningElement {
    @track count = 0;
    handleIncrement() {
        this.count += 1;
    }
}
```

```xml
<!-- counterComponent.js-meta.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>59.0</apiVersion>
    <isExposed>true</isExposed>
    <targets>
        <target>lightning__AppPage</target>
        <target>lightning__RecordPage</target>
    </targets>
</LightningComponentBundle>
```

[Documentation](https://jeffallan.github.io/claude-skills/skills/platform/salesforce-developer/)
