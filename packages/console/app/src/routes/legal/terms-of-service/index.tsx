import "../../brand/index.css"
import "./index.css"
import { Title, Meta, Link } from "@solidjs/meta"
import { Header } from "~/component/header"
import { config } from "~/config"
import { Footer } from "~/component/footer"
import { Legal } from "~/component/legal"

export default function TermsOfService() {
  return (
    <main data-page="legal">
      <Title>OpenCode | Terms of Service</Title>
      <Link rel="canonical" href={`${config.baseUrl}/legal/terms-of-service`} />
      <Meta name="description" content="OpenCode terms of service" />
      <div data-component="container">
        <Header />

        <div data-component="content">
          <section data-component="brand-content">
            <article data-component="terms-of-service">
              <h1>Terms of Use</h1>
              <p class="effective-date">Effective date: Dec 16, 2025</p>

              <p>
                Welcome to OpenCode. Please read on to learn the rules and restrictions that govern your use of OpenCode
                (the "Services"). If you have any questions, comments, or concerns regarding these terms or the
                Services, please contact us at:
              </p>

              <p>
                Email: <a href="mailto:contact@anoma.ly">contact@anoma.ly</a>
              </p>

              <p>
                These Terms of Use (the "Terms") are a binding contract between you and{" "}
                <strong>ANOMALY INNOVATIONS, INC.</strong> ("OpenCode," "we" and "us"). Your use of the Services in any
                way means that you agree to all of these Terms, and these Terms will remain in effect while you use the
                Services. These Terms include the provisions in this document as well as those in the Privacy Policy{" "}
                <a href="/legal/privacy-policy">https://opencode.ai/legal/privacy-policy</a>.{" "}
                <strong>
                  Your use of or participation in certain Services may also be subject to additional policies, rules
                  and/or conditions ("Additional Terms"), which are incorporated herein by reference, and you understand
                  and agree that by using or participating in any such Services, you agree to also comply with these
                  Additional Terms.
                </strong>
              </p>

              <p>
                Please read these Terms carefully. They cover important information about Services provided to you and
                any charges, taxes, and fees we bill you. These Terms include information about{" "}
                <a href="#will-these-terms-ever-change">future changes to these Terms</a>,{" "}
                <a href="#recurring-billing">automatic renewals</a>,{" "}
                <a href="#limitation-of-liability">limitations of liability</a>,{" "}
                <a href="#waiver-of-class">a class action waiver</a> and{" "}
                <a href="#arbitration-agreement">resolution of disputes by arbitration instead of in court</a>.{" "}
                <strong>
                  PLEASE NOTE THAT YOUR USE OF AND ACCESS TO OUR SERVICES ARE SUBJECT TO THE FOLLOWING TERMS; IF YOU DO
                  NOT AGREE TO ALL OF THE FOLLOWING, YOU MAY NOT USE OR ACCESS THE SERVICES IN ANY MANNER.
                </strong>
              </p>

              <p>
                <strong>ARBITRATION NOTICE AND CLASS ACTION WAIVER:</strong> EXCEPT FOR CERTAIN TYPES OF DISPUTES
                DESCRIBED IN THE <a href="#arbitration-agreement">ARBITRATION AGREEMENT SECTION BELOW</a>, YOU AGREE
                THAT DISPUTES BETWEEN YOU AND US WILL BE RESOLVED BY BINDING, INDIVIDUAL ARBITRATION AND YOU WAIVE YOUR
                RIGHT TO PARTICIPATE IN A CLASS ACTION LAWSUIT OR CLASS-WIDE ARBITRATION.
              </p>

              <h2 id="what-is-opencode">What is OpenCode?</h2>
              <p>
                OpenCode is an AI-powered coding agent that helps you write, understand, and modify code using large
                language models. Certain of these large language models are provided by third parties ("Third Party
                Models") and certain of these models are provided directly by us if you use the OpenCode Zen paid
                offering ("Zen"). Regardless of whether you use Third Party Models or Zen, OpenCode enables you to
                access the functionality of models through a coding agent running within your terminal.
              </p>

              <h2 id="will-these-terms-ever-change">Will these Terms ever change?</h2>
              <p>
                We are constantly trying to improve our Services, so these Terms may need to change along with our
                Services. We reserve the right to change the Terms at any time, but if we do, we will place a notice on
                our site located at opencode.ai, send you an email, and/or notify you by some other means.
              </p>

              <p>
                If you don't agree with the new Terms, you are free to reject them; unfortunately, that means you will
                no longer be able to use the Services. If you use the Services in any way after a change to the Terms is
                effective, that means you agree to all of the changes.
              </p>

              <p>
                Except for changes by us as described here, no other amendment or modification of these Terms will be
                effective unless in writing and signed by both you and us.
              </p>

              <h2 id="what-about-my-privacy">What about my privacy?</h2>
              <p>
                OpenCode takes the privacy of its users very seriously. For the current OpenCode Privacy Policy, please
                click here{" "}
                <a href="https://opencode.ai/legal/privacy-policy">https://opencode.ai/legal/privacy-policy</a>.
              </p>

              <h3>Children's Online Privacy Protection Act</h3>
              <p>
                The Children's Online Privacy Protection Act ("COPPA") requires that online service providers obtain
                parental consent before they knowingly collect personally identifiable information online from children
                who are under 13 years of age. We do not knowingly collect or solicit personally identifiable
                information from children under 13 years of age; if you are a child under 13 years of age, please do not
                attempt to register for or otherwise use the Services or send us any personal information. If we learn
                we have collected personal information from a child under 13 years of age, we will delete that
                information as quickly as possible. If you believe that a child under 13 years of age may have provided
                us personal information, please contact us at <a href="mailto:contact@anoma.ly">contact@anoma.ly</a>.
              </p>

              <h2 id="what-are-the-basics">What are the basics of using OpenCode?</h2>
              <p>
                You represent and warrant that you are an individual of legal age to form a binding contract (or if not,
                you've received your parent's or guardian's permission to use the Services and have gotten your parent
                or guardian to agree to these Terms on your behalf). If you're agreeing to these Terms on behalf of an
                organization or entity, you represent and warrant that you are authorized to agree to these Terms on
                that organization's or entity's behalf and bind them to these Terms (in which case, the references to
                "you" and "your" in these Terms, except for in this sentence, refer to that organization or entity).
              </p>

              <p>
                You will only use the Services for your own internal use, and not on behalf of or for the benefit of any
                third party, and only in a manner that complies with all laws that apply to you. If your use of the
                Services is prohibited by applicable laws, then you aren't authorized to use the Services. We can't and
                won't be responsible for your using the Services in a way that breaks the law.
              </p>

              <h2 id="are-there-restrictions">Are there restrictions in how I can use the Services?</h2>
              <p>
                You represent, warrant, and agree that you will not provide or contribute anything, including any
                Content (as that term is defined below), to the Services, or otherwise use or interact with the
                Services, in a manner that:
              </p>

              <ol style="list-style-type: lower-alpha;">
                <li>
                  infringes or violates the intellectual property rights or any other rights of anyone else (including
                  OpenCode);
                </li>
                <li>
                  violates any law or regulation, including, without limitation, any applicable export control laws,
                  privacy laws or any other purpose not reasonably intended by OpenCode;
                </li>
                <li>
                  is dangerous, harmful, fraudulent, deceptive, threatening, harassing, defamatory, obscene, or
                  otherwise objectionable;
                </li>
                <li>automatically or programmatically extracts data or Output (defined below);</li>
                <li>Represent that the Output was human-generated when it was not;</li>
                <li>
                  uses Output to develop artificial intelligence models that compete with the Services or any Third
                  Party Models;
                </li>
                <li>
                  attempts, in any manner, to obtain the password, account, or other security information from any other
                  user;
                </li>
                <li>
                  violates the security of any computer network, or cracks any passwords or security encryption codes;
                </li>
                <li>
                  runs Maillist, Listserv, any form of auto-responder or "spam" on the Services, or any processes that
                  run or are activated while you are not logged into the Services, or that otherwise interfere with the
                  proper working of the Services (including by placing an unreasonable load on the Services'
                  infrastructure);
                </li>
                <li>
                  "crawls," "scrapes," or "spiders" any page, data, or portion of or relating to the Services or Content
                  (through use of manual or automated means);
                </li>
                <li>copies or stores any significant portion of the Content; or</li>
                <li>
                  decompiles, reverse engineers, or otherwise attempts to obtain the source code or underlying ideas or
                  information of or relating to the Services.
                </li>
              </ol>

              <p>
                A violation of any of the foregoing is grounds for termination of your right to use or access the
                Services.
              </p>

              <h2 id="who-owns-the-services-and-content">Who Owns the Services and Content?</h2>

              <h3>Our IP</h3>
              <p>
                We retain all right, title and interest in and to the Services. Except as expressly set forth herein, no
                rights to the Services or Third Party Models are granted to you.
              </p>

              <h3>Your IP</h3>
              <p>
                You may provide input to the Services ("Input"), and receive output from the Services based on the Input
                ("Output"). Input and Output are collectively "Content." You are responsible for Content, including
                ensuring that it does not violate any applicable law or these Terms. You represent and warrant that you
                have all rights, licenses, and permissions needed to provide Input to our Services.
              </p>

              <p>
                As between you and us, and to the extent permitted by applicable law, you (a) retain your ownership
                rights in Input and (b) own the Output. We hereby assign to you all our right, title, and interest, if
                any, in and to Output.
              </p>

              <p>
                Due to the nature of our Services and artificial intelligence generally, output may not be unique and
                other users may receive similar output from our Services. Our assignment above does not extend to other
                users' output.
              </p>

              <p>
                We use Content to provide our Services, comply with applicable law, enforce our terms and policies, and
                keep our Services safe. In addition, if you are using the Services through an unpaid account, we may use
                Content to further develop and improve our Services.
              </p>

              <p>
                If you use OpenCode with Third Party Models, then your Content will be subject to the data retention
                policies of the providers of such Third Party Models. Although we will not retain your Content, we
                cannot and do not control the retention practices of Third Party Model providers. You should review the
                terms and conditions applicable to any Third Party Model for more information about the data use and
                retention policies applicable to such Third Party Models.
              </p>

              <h2 id="what-about-third-party-models">What about Third Party Models?</h2>
              <p>
                The Services enable you to access and use Third Party Models, which are not owned or controlled by
                OpenCode. Your ability to access Third Party Models is contingent on you having API keys or otherwise
                having the right to access such Third Party Models.
              </p>

              <p>
                OpenCode has no control over, and assumes no responsibility for, the content, accuracy, privacy
                policies, or practices of any providers of Third Party Models. We encourage you to read the terms and
                conditions and privacy policy of each provider of a Third Party Model that you choose to utilize. By
                using the Services, you release and hold us harmless from any and all liability arising from your use of
                any Third Party Model.
              </p>

              <h2 id="will-opencode-ever-change-the-services">Will OpenCode ever change the Services?</h2>
              <p>
                We're always trying to improve our Services, so they may change over time. We may suspend or discontinue
                any part of the Services, or we may introduce new features or impose limits on certain features or
                restrict access to parts or all of the Services.
              </p>

              <h2 id="do-the-services-cost-anything">Do the Services cost anything?</h2>
              <p>
                The Services may be free or we may charge a fee for using the Services. If you are using a free version
                of the Services, we will notify you before any Services you are then using begin carrying a fee, and if
                you wish to continue using such Services, you must pay all applicable fees for such Services. Any and
                all such charges, fees or costs are your sole responsibility. You should consult with your
              </p>

              <h3>Paid Services</h3>
              <p>
                Certain of our Services, including Zen, may be subject to payments now or in the future (the "Paid
                Services"). Please see our Paid Services page <a href="/zen">https://opencode.ai/zen</a> for a
                description of the current Paid Services. Please note that any payment terms presented to you in the
                process of using or signing up for a Paid Service are deemed part of these Terms.
              </p>

              <h3>Billing</h3>
              <p>
                We use a third-party payment processor (the "Payment Processor") to bill you through a payment account
                linked to your account on the Services (your "Billing Account") for use of the Paid Services. The
                processing of payments will be subject to the terms, conditions and privacy policies of the Payment
                Processor in addition to these Terms. Currently, we use Stripe, Inc. as our Payment Processor. You can
                access Stripe's Terms of Service at{" "}
                <a href="https://stripe.com/us/checkout/legal">https://stripe.com/us/checkout/legal</a> and their
                Privacy Policy at <a href="https://stripe.com/us/privacy">https://stripe.com/us/privacy</a>. We are not
                responsible for any error by, or other acts or omissions of, the Payment Processor. By choosing to use
                Paid Services, you agree to pay us, through the Payment Processor, all charges at the prices then in
                effect for any use of such Paid Services in accordance with the applicable payment terms, and you
                authorize us, through the Payment Processor, to charge your chosen payment provider (your "Payment
                Method"). You agree to make payment using that selected Payment Method. We reserve the right to correct
                any errors or mistakes that the Payment Processor makes even if it has already requested or received
                payment.
              </p>

              <h3>Payment Method</h3>
              <p>
                The terms of your payment will be based on your Payment Method and may be determined by agreements
                between you and the financial institution, credit card issuer or other provider of your chosen Payment
                Method. If we, through the Payment Processor, do not receive payment from you, you agree to pay all
                amounts due on your Billing Account upon demand.
              </p>

              <h3 id="recurring-billing">Recurring Billing</h3>
              <p>
                Some of the Paid Services may consist of an initial period, for which there is a one-time charge,
                followed by recurring period charges as agreed to by you. By choosing a recurring payment plan, you
                acknowledge that such Services have an initial and recurring payment feature and you accept
                responsibility for all recurring charges prior to cancellation. WE MAY SUBMIT PERIODIC CHARGES (E.G.,
                MONTHLY) WITHOUT FURTHER AUTHORIZATION FROM YOU, UNTIL YOU PROVIDE PRIOR NOTICE (RECEIPT OF WHICH IS
                CONFIRMED BY US) THAT YOU HAVE TERMINATED THIS AUTHORIZATION OR WISH TO CHANGE YOUR PAYMENT METHOD. SUCH
                NOTICE WILL NOT AFFECT CHARGES SUBMITTED BEFORE WE REASONABLY COULD ACT. TO TERMINATE YOUR AUTHORIZATION
                OR CHANGE YOUR PAYMENT METHOD, GO TO ACCOUNT SETTINGS{" "}
                <a href="https://opencode.ai/auth">https://opencode.ai/auth</a>.
              </p>

              <h3>Free Trials and Other Promotions</h3>
              <p>
                Any free trial or other promotion that provides access to a Paid Service must be used within the
                specified time of the trial. You must stop using a Paid Service before the end of the trial period in
                order to avoid being charged for that Paid Service. If you cancel prior to the end of the trial period
                and are inadvertently charged for a Paid Service, please contact us at{" "}
                <a href="mailto:contact@anoma.ly">contact@anoma.ly</a>.
              </p>

              <h2 id="what-if-i-want-to-stop">What if I want to stop using the Services?</h2>
              <p>
                You're free to do that at any time; please refer to our Privacy Policy{" "}
                <a href="/legal/privacy-policy">https://opencode.ai/legal/privacy-policy</a>, as well as the licenses
                above, to understand how we treat information you provide to us after you have stopped using our
                Services.
              </p>

              <p>
                OpenCode is also free to terminate (or suspend access to) your use of the Services for any reason in our
                discretion, including your breach of these Terms. OpenCode has the sole right to decide whether you are
                in violation of any of the restrictions set forth in these Terms.
              </p>

              <p>
                Provisions that, by their nature, should survive termination of these Terms shall survive termination.
                By way of example, all of the following will survive termination: any obligation you have to pay us or
                indemnify us, any limitations on our liability, any terms regarding ownership or intellectual property
                rights, and terms regarding disputes between us, including without limitation the arbitration agreement.
              </p>

              <h2 id="what-else-do-i-need-to-know">What else do I need to know?</h2>

              <h3>Warranty Disclaimer</h3>
              <p>
                OpenCode and its licensors, suppliers, partners, parent, subsidiaries or affiliated entities, and each
                of their respective officers, directors, members, employees, consultants, contract employees,
                representatives and agents, and each of their respective successors and assigns (OpenCode and all such
                parties together, the "OpenCode Parties") make no representations or warranties concerning the Services,
                including without limitation regarding any Content contained in or accessed through the Services, and
                the OpenCode Parties will not be responsible or liable for the accuracy, copyright compliance, legality,
                or decency of material contained in or accessed through the Services or any claims, actions, suits
                procedures, costs, expenses, damages or liabilities arising out of use of, or in any way related to your
                participation in, the Services. The OpenCode Parties make no representations or warranties regarding
                suggestions or recommendations of services or products offered or purchased through or in connection
                with the Services. THE SERVICES AND CONTENT ARE PROVIDED BY OPENCODE (AND ITS LICENSORS AND SUPPLIERS)
                ON AN "AS-IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING, WITHOUT
                LIMITATION, IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT,
                OR THAT USE OF THE SERVICES WILL BE UNINTERRUPTED OR ERROR-FREE. SOME STATES DO NOT ALLOW LIMITATIONS ON
                HOW LONG AN IMPLIED WARRANTY LASTS, SO THE ABOVE LIMITATIONS MAY NOT APPLY TO YOU.
              </p>

              <h3 id="limitation-of-liability">Limitation of Liability</h3>
              <p>
                TO THE FULLEST EXTENT ALLOWED BY APPLICABLE LAW, UNDER NO CIRCUMSTANCES AND UNDER NO LEGAL THEORY
                (INCLUDING, WITHOUT LIMITATION, TORT, CONTRACT, STRICT LIABILITY, OR OTHERWISE) SHALL ANY OF THE
                OPENCODE PARTIES BE LIABLE TO YOU OR TO ANY OTHER PERSON FOR (A) ANY INDIRECT, SPECIAL, INCIDENTAL,
                PUNITIVE OR CONSEQUENTIAL DAMAGES OF ANY KIND, INCLUDING DAMAGES FOR LOST PROFITS, BUSINESS
                INTERRUPTION, LOSS OF DATA, LOSS OF GOODWILL, WORK STOPPAGE, ACCURACY OF RESULTS, OR COMPUTER FAILURE OR
                MALFUNCTION, (B) ANY SUBSTITUTE GOODS, SERVICES OR TECHNOLOGY, (C) ANY AMOUNT, IN THE AGGREGATE, IN
                EXCESS OF THE GREATER OF (I) ONE-HUNDRED ($100) DOLLARS OR (II) THE AMOUNTS PAID AND/OR PAYABLE BY YOU
                TO OPENCODE IN CONNECTION WITH THE SERVICES IN THE TWELVE (12) MONTH PERIOD PRECEDING THIS APPLICABLE
                CLAIM OR (D) ANY MATTER BEYOND OUR REASONABLE CONTROL. SOME STATES DO NOT ALLOW THE EXCLUSION OR
                LIMITATION OF INCIDENTAL OR CONSEQUENTIAL OR CERTAIN OTHER DAMAGES, SO THE ABOVE LIMITATION AND
                EXCLUSIONS MAY NOT APPLY TO YOU.
              </p>

              <h3>Indemnity</h3>
              <p>
                You agree to indemnify and hold the OpenCode Parties harmless from and against any and all claims,
                liabilities, damages (actual and consequential), losses and expenses (including attorneys' fees) arising
                from or in any way related to any claims relating to (a) your use of the Services, and (b) your
                violation of these Terms. In the event of such a claim, suit, or action ("Claim"), we will attempt to
                provide notice of the Claim to the contact information we have for your account (provided that failure
                to deliver such notice shall not eliminate or reduce your indemnification obligations hereunder).
              </p>

              <h3>Assignment</h3>
              <p>
                You may not assign, delegate or transfer these Terms or your rights or obligations hereunder, or your
                Services account, in any way (by operation of law or otherwise) without OpenCode's prior written
                consent. We may transfer, assign, or delegate these Terms and our rights and obligations without
                consent.
              </p>

              <h3>Choice of Law</h3>
              <p>
                These Terms are governed by and will be construed under the Federal Arbitration Act, applicable federal
                law, and the laws of the State of Delaware, without regard to the conflicts of laws provisions thereof.
              </p>

              <h3 id="arbitration-agreement">Arbitration Agreement</h3>
              <p>
                Please read the following ARBITRATION AGREEMENT carefully because it requires you to arbitrate certain
                disputes and claims with OpenCode and limits the manner in which you can seek relief from OpenCode. Both
                you and OpenCode acknowledge and agree that for the purposes of any dispute arising out of or relating
                to the subject matter of these Terms, OpenCode's officers, directors, employees and independent
                contractors ("Personnel") are third-party beneficiaries of these Terms, and that upon your acceptance of
                these Terms, Personnel will have the right (and will be deemed to have accepted the right) to enforce
                these Terms against you as the third-party beneficiary hereof.
              </p>

              <h4>Arbitration Rules; Applicability of Arbitration Agreement</h4>
              <p>
                The parties shall use their best efforts to settle any dispute, claim, question, or disagreement arising
                out of or relating to the subject matter of these Terms directly through good-faith negotiations, which
                shall be a precondition to either party initiating arbitration. If such negotiations do not resolve the
                dispute, it shall be finally settled by binding arbitration in New Castle County, Delaware. The
                arbitration will proceed in the English language, in accordance with the JAMS Streamlined Arbitration
                Rules and Procedures (the "Rules") then in effect, by one commercial arbitrator with substantial
                experience in resolving intellectual property and commercial contract disputes. The arbitrator shall be
                selected from the appropriate list of JAMS arbitrators in accordance with such Rules. Judgment upon the
                award rendered by such arbitrator may be entered in any court of competent jurisdiction.
              </p>

              <h4>Costs of Arbitration</h4>
              <p>
                The Rules will govern payment of all arbitration fees. OpenCode will pay all arbitration fees for claims
                less than seventy-five thousand ($75,000) dollars. OpenCode will not seek its attorneys' fees and costs
                in arbitration unless the arbitrator determines that your claim is frivolous.
              </p>

              <h4>Small Claims Court; Infringement</h4>
              <p>
                Either you or OpenCode may assert claims, if they qualify, in small claims court in New Castle County,
                Delaware or any United States county where you live or work. Furthermore, notwithstanding the foregoing
                obligation to arbitrate disputes, each party shall have the right to pursue injunctive or other
                equitable relief at any time, from any court of competent jurisdiction, to prevent the actual or
                threatened infringement, misappropriation or violation of a party's copyrights, trademarks, trade
                secrets, patents or other intellectual property rights.
              </p>

              <h4>Waiver of Jury Trial</h4>
              <p>
                YOU AND OPENCODE WAIVE ANY CONSTITUTIONAL AND STATUTORY RIGHTS TO GO TO COURT AND HAVE A TRIAL IN FRONT
                OF A JUDGE OR JURY. You and OpenCode are instead choosing to have claims and disputes resolved by
                arbitration. Arbitration procedures are typically more limited, more efficient, and less costly than
                rules applicable in court and are subject to very limited review by a court. In any litigation between
                you and OpenCode over whether to vacate or enforce an arbitration award, YOU AND OPENCODE WAIVE ALL
                RIGHTS TO A JURY TRIAL, and elect instead to have the dispute be resolved by a judge.
              </p>

              <h4 id="waiver-of-class">Waiver of Class or Consolidated Actions</h4>
              <p>
                ALL CLAIMS AND DISPUTES WITHIN THE SCOPE OF THIS ARBITRATION AGREEMENT MUST BE ARBITRATED OR LITIGATED
                ON AN INDIVIDUAL BASIS AND NOT ON A CLASS BASIS. CLAIMS OF MORE THAN ONE CUSTOMER OR USER CANNOT BE
                ARBITRATED OR LITIGATED JOINTLY OR CONSOLIDATED WITH THOSE OF ANY OTHER CUSTOMER OR USER. If however,
                this waiver of class or consolidated actions is deemed invalid or unenforceable, neither you nor
                OpenCode is entitled to arbitration; instead all claims and disputes will be resolved in a court as set
                forth in (g) below.
              </p>

              <h4>Opt-out</h4>
              <p>
                You have the right to opt out of the provisions of this Section by sending written notice of your
                decision to opt out to the following address: [ADDRESS], [CITY], Canada [ZIP CODE] postmarked within
                thirty (30) days of first accepting these Terms. You must include (i) your name and residence address,
                (ii) the email address and/or telephone number associated with your account, and (iii) a clear statement
                that you want to opt out of these Terms' arbitration agreement.
              </p>

              <h4>Exclusive Venue</h4>
              <p>
                If you send the opt-out notice in (f), and/or in any circumstances where the foregoing arbitration
                agreement permits either you or OpenCode to litigate any dispute arising out of or relating to the
                subject matter of these Terms in court, then the foregoing arbitration agreement will not apply to
                either party, and both you and OpenCode agree that any judicial proceeding (other than small claims
                actions) will be brought in the state or federal courts located in, respectively, New Castle County,
                Delaware, or the federal district in which that county falls.
              </p>

              <h4>Severability</h4>
              <p>
                If the prohibition against class actions and other claims brought on behalf of third parties contained
                above is found to be unenforceable, then all of the preceding language in this Arbitration Agreement
                section will be null and void. This arbitration agreement will survive the termination of your
                relationship with OpenCode.
              </p>

              <h3>Miscellaneous</h3>
              <p>
                You will be responsible for paying, withholding, filing, and reporting all taxes, duties, and other
                governmental assessments associated with your activity in connection with the Services, provided that
                the OpenCode may, in its sole discretion, do any of the foregoing on your behalf or for itself as it
                sees fit. The failure of either you or us to exercise, in any way, any right herein shall not be deemed
                a waiver of any further rights hereunder. If any provision of these Terms are found to be unenforceable
                or invalid, that provision will be limited or eliminated, to the minimum extent necessary, so that these
                Terms shall otherwise remain in full force and effect and enforceable. You and OpenCode agree that these
                Terms are the complete and exclusive statement of the mutual understanding between you and OpenCode, and
                that these Terms supersede and cancel all previous written and oral agreements, communications and other
                understandings relating to the subject matter of these Terms. You hereby acknowledge and agree that you
                are not an employee, agent, partner, or joint venture of OpenCode, and you do not have any authority of
                any kind to bind OpenCode in any respect whatsoever.
              </p>

              <p>
                Except as expressly set forth in the section above regarding the arbitration agreement, you and OpenCode
                agree there are no third-party beneficiaries intended under these Terms.
              </p>
            </article>
          </section>
        </div>
        <Footer />
      </div>
      <Legal />
    </main>
  )
}
