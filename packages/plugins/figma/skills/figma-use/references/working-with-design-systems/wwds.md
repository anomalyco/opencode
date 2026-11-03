# Working with design systems

When working with design systems in Figma, there can be many nuances when deciding how to do the right thing. Figma's model for patterns is form-agnostic, this is one of its strengths, allowing people to refer to a pattern in a spec that may take distinct forms in different codebases. However, this can result in complex procedures and nuances when translating something to Figma and back. Figma has components, tokens, and other reusable patterns (text and effect styles, prototyping actions, etc). The way that Figma's paradigms function can be difficult to translate one to one.

To make translation of patterns work between design and code forms, it is important that teams think about alignment while also embracing the function of representation (design) and implementation (production) forms independently as complementary pieces of a shared puzzle.

For the process of design, the desirable state of a system is something that is structured with experimentation in mind, something that is highly visual, easy to iterate, test, and confirm new ideas. Depending on the product and team, exploration might be mandatory to be done within the confines of an existing system, for other scenarios, exploration of new territory is the priority, a place for the system to grow into, or a new system to be made. Figma's platform allows for teams to validate, align, and collaborate on new ideas, then solidify them in product designs, which are ultimately specs. That work is supported by design libraries and that process can include code in prototypes and other less permanent forms as much as it does Figma's native paradigms.

For the process of implementation, the desirable state for production code is rigidity, efficiency, and related to secure data and functional layers. Developer experience implementing a design and the designer experience surfacing and committing to an idea are paths from distinct points of to the same shared outcome. Their optimization looks different, and that is reflected when you engage with Figma's APIs.

The key is not to avoid gaps, but to make sure they are definitively bridgable. Translation layers help agents and people go between representational and production forms.

The Figma paradigms you will need to understand when working with design systems. In each file below there will be further links to instructions for using and creating:

- [Components](wwds-components.md)
- [Variables](wwds-variables.md)
- [Effect Styles](wwds-effect-styles.md)
- [Text Styles](wwds-text-styles.md)

Things you might be asked to do with respect to design systems:

- Create patterns in Figma that match patterns in code
  - Likely (but not exclusively) to get up to speed so that visual riffing can be done in Figma
  - Create variables based on a stylesheet, JSON format, some other theme definition
  - Create Figma text styles that match a type hierarchy defined somewhere
  - Create components based on existing code components
- Sync between code and design forms
  - Making sure that Figma's concepts match a production form
- Use an existing Figma design library to create something
  - This something could be matching an existing code form, an image, or just a prompt
- Clean up a design to match some code pattern

## Things to remember

Many people will use these tools to try out ideas, and not everything you get asked to do will feel realistic for the environment you are running in. It is important to contextualize that, but then also know when you are definitively working in a production environment and there is a very real task you need to perform consistently.

Not everyone asking you to do something knows what they should be doing. You must figure out if the request is to generically perform design systems actions, uphold existing the rules that are codified in Figma or in a codebase, demonstrate an idea, enforce existing guidelines, etc.

Not every environment you are working in has the same degree of expertise and maturity. Some systems will be very complex and the priority and have a lot of things to parse through to get to the right outcome. Some scenarios will be very immature and even starting from scratch. Something as simple as creating a component could be very elementary or very sophisticated depending on the environment. The instructions you find here are attempting to be unbiased.

For example, how you reflect the "hover" state of a button could be left entirely up to you to make a reasonable decision for a user that is playing around with getting a decent example scaffolded using best practices, but it could also be something that exists definitively in the codebase and you need to go match it. That codebase definition could be refering to design tokens that do not yet exist in code that change dark and light mode values. In this second example you are now needing to do a bunch of variables work just to add a hover state to a component with proper dark and light mode support, where in the first scenario, you can kinda just do whatever is easiest. This is the line you will be walking, and making good judgement here is about doing whatever is the smartest thing in the environment you are in.
