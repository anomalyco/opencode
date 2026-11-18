import { ComponentResourceOptions, Output, all, output } from "@pulumi/pulumi";
import { Component, Transform, transform } from "../component";
import { Input } from "../input";
import { ec2, getAvailabilityZonesOutput } from "@pulumi/aws";

export interface VpcArgs {
  /**
   * Number of Availability Zones or AZs for the VPC. By default, it creates a VPC with 2
   * AZs since services like RDS and Fargate need at least 2 AZs.
   * @default `2`
   * @example
   * ```ts
   * {
   *   az: 3
   * }
   * ```
   */
  az?: Input<number>;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the EC2 VPC resource.
     */
    vpc?: Transform<ec2.VpcArgs>;
    /**
     * Transform the EC2 Internet Gateway resource.
     */
    internetGateway?: Transform<ec2.InternetGatewayArgs>;
    /**
     * Transform the EC2 NAT Gateway resource.
     */
    natGateway?: Transform<ec2.NatGatewayArgs>;
    /**
     * Transform the EC2 Elastic IP resource.
     */
    elasticIp?: Transform<ec2.EipArgs>;
    /**
     * Transform the EC2 Security Group resource.
     */
    securityGroup?: Transform<ec2.SecurityGroupArgs>;
    /**
     * Transform the EC2 public subnet resource.
     */
    publicSubnet?: Transform<ec2.SubnetArgs>;
    /**
     * Transform the EC2 private subnet resource.
     */
    privateSubnet?: Transform<ec2.SubnetArgs>;
    /**
     * Transform the EC2 route table resource for the public subnet.
     */
    publicRouteTable?: Transform<ec2.RouteTableArgs>;
    /**
     * Transform the EC2 route table resource for the private subnet.
     */
    privateRouteTable?: Transform<ec2.RouteTableArgs>;
  };
}

interface VpcRef {
  ref: boolean;
  vpc: ec2.Vpc;
  internetGateway: ec2.InternetGateway;
  securityGroup: ec2.SecurityGroup;
  privateSubnets: Output<ec2.Subnet[]>;
  privateRouteTables: Output<ec2.RouteTable[]>;
  publicSubnets: Output<ec2.Subnet[]>;
  publicRouteTables: Output<ec2.RouteTable[]>;
  natGateways: Output<ec2.NatGateway[]>;
  elasticIps: Output<ec2.Eip[]>;
}

/**
 * The `Vpc` component lets you add a VPC to your app, but it has been deprecated because
 * it does not support modifying the number of Availability Zones (AZs) after VPC creation.
 *
 * For existing usage, rename `sst.aws.Vpc` to `sst.aws.Vpc.v1`. For new VPCs, use
 * the latest [`Vpc`](/docs/component/aws/vpc) component instead.
 *
 * :::caution
 * This component has been deprecated.
 * :::
 *
 * This creates a VPC with 2 Availability Zones by default. It also creates the following
 * resources:
 *
 * 1. A security group.
 * 2. A public subnet in each AZ.
 * 3. A private subnet in each AZ.
 * 4. An Internet Gateway, all the traffic from the public subnets are routed through it.
 * 5. A NAT Gateway in each AZ. All the traffic from the private subnets are routed to the
 *    NAT Gateway in the same AZ.
 *
 * :::note
 * By default, this creates two NAT Gateways, one in each AZ. And it roughly costs $33 per
 * NAT Gateway per month.
 * :::
 *
 * NAT Gateways are billed per hour and per gigabyte of data processed. By default,
 * this creates a NAT Gateway in each AZ. And this would be roughly $33 per NAT
 * Gateway per month. Make sure to [review the pricing](https://aws.amazon.com/vpc/pricing/).
 *
 * @example
 *
 * #### Create a VPC
 *
 * ```ts title="sst.config.ts"
 * new sst.aws.Vpc.v1("MyVPC");
 * ```
 *
 * #### Create it with 3 Availability Zones
 *
 * ```ts title="sst.config.ts" {2}
 * new sst.aws.Vpc.v1("MyVPC", {
 *   az: 3
 * });
 * ```
 */
export class Vpc extends Component {
  private vpc: ec2.Vpc;
  private internetGateway: ec2.InternetGateway;
  private securityGroup: ec2.SecurityGroup;
  private natGateways: Output<ec2.NatGateway[]>;
  private elasticIps: Output<ec2.Eip[]>;
  private _publicSubnets: Output<ec2.Subnet[]>;
  private _privateSubnets: Output<ec2.Subnet[]>;
  private publicRouteTables: Output<ec2.RouteTable[]>;
  private privateRouteTables: Output<ec2.RouteTable[]>;

  constructor(name: string, args?: VpcArgs, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    if (args && "ref" in args) {
      const ref = args as VpcRef;
      this.vpc = ref.vpc;
      this.internetGateway = ref.internetGateway;
      this.securityGroup = ref.securityGroup;
      this._publicSubnets = output(ref.publicSubnets);
      this._privateSubnets = output(ref.privateSubnets);
      this.publicRouteTables = output(ref.publicRouteTables);
      this.privateRouteTables = output(ref.privateRouteTables);
      this.natGateways = output(ref.natGateways);
      this.elasticIps = ref.elasticIps;
      return;
    }

    const parent = this;

    const zones = normalizeAz();

    const vpc = createVpc();
    const internetGateway = createInternetGateway();
    const securityGroup = createSecurityGroup();
    const { publicSubnets, publicRouteTables } = createPublicSubnets();
    const { elasticIps, natGateways } = createNatGateways();
    const { privateSubnets, privateRouteTables } = createPrivateSubnets();

    this.vpc = vpc;
    this.internetGateway = internetGateway;
    this.securityGroup = securityGroup;
    this.natGateways = natGateways;
    this.elasticIps = elasticIps;
    this._publicSubnets = publicSubnets;
    this._privateSubnets = privateSubnets;
    this.publicRouteTables = publicRouteTables;
    this.privateRouteTables = privateRouteTables;

    function normalizeAz() {
      const zones = getAvailabilityZonesOutput({
        state: "available",
      });
      return all([zones, args?.az ?? 2]).apply(([zones, az]) =>
        Array(az)
          .fill(0)
          .map((_, i) => zones.names[i]),
      );
    }

    function createVpc() {
      return new ec2.Vpc(
        ...transform(
          args?.transform?.vpc,
          `${name}Vpc`,
          {
            cidrBlock: "10.0.0.0/16",
            enableDnsSupport: true,
            enableDnsHostnames: true,
          },
          { parent },
        ),
      );
    }

    function createInternetGateway() {
      return new ec2.InternetGateway(
        ...transform(
          args?.transform?.internetGateway,
          `${name}InternetGateway`,
          {
            vpcId: vpc.id,
          },
          { parent },
        ),
      );
    }

    function createSecurityGroup() {
      return new ec2.SecurityGroup(
        ...transform(
          args?.transform?.securityGroup,
          `${name}SecurityGroup`,
          {
            vpcId: vpc.id,
            egress: [
              {
                fromPort: 0,
                toPort: 0,
                protocol: "-1",
                cidrBlocks: ["0.0.0.0/0"],
              },
            ],
            ingress: [
              {
                fromPort: 0,
                toPort: 0,
                protocol: "-1",
                cidrBlocks: ["0.0.0.0/0"],
              },
            ],
          },
          { parent },
        ),
      );
    }

    function createNatGateways() {
      const ret = publicSubnets.apply((subnets) =>
        subnets.map((subnet, i) => {
          const elasticIp = new ec2.Eip(
            ...transform(
              args?.transform?.elasticIp,
              `${name}ElasticIp${i + 1}`,
              {
                vpc: true,
              },
              { parent },
            ),
          );

          const natGateway = new ec2.NatGateway(
            ...transform(
              args?.transform?.natGateway,
              `${name}NatGateway${i + 1}`,
              {
                subnetId: subnet.id,
                allocationId: elasticIp.id,
              },
              { parent },
            ),
          );
          return { elasticIp, natGateway };
        }),
      );

      return {
        elasticIps: ret.apply((ret) => ret.map((r) => r.elasticIp)),
        natGateways: ret.apply((ret) => ret.map((r) => r.natGateway)),
      };
    }

    function createPublicSubnets() {
      const ret = zones.apply((zones) =>
        zones.map((zone, i) => {
          const subnet = new ec2.Subnet(
            ...transform(
              args?.transform?.publicSubnet,
              `${name}PublicSubnet${i + 1}`,
              {
                vpcId: vpc.id,
                cidrBlock: `10.0.${i + 1}.0/24`,
                availabilityZone: zone,
                mapPublicIpOnLaunch: true,
              },
              { parent },
            ),
          );

          const routeTable = new ec2.RouteTable(
            ...transform(
              args?.transform?.publicRouteTable,
              `${name}PublicRouteTable${i + 1}`,
              {
                vpcId: vpc.id,
                routes: [
                  {
                    cidrBlock: "0.0.0.0/0",
                    gatewayId: internetGateway.id,
                  },
                ],
              },
              { parent },
            ),
          );

          new ec2.RouteTableAssociation(
            `${name}PublicRouteTableAssociation${i + 1}`,
            {
              subnetId: subnet.id,
              routeTableId: routeTable.id,
            },
            { parent },
          );

          return { subnet, routeTable };
        }),
      );

      return {
        publicSubnets: ret.apply((ret) => ret.map((r) => r.subnet)),
        publicRouteTables: ret.apply((ret) => ret.map((r) => r.routeTable)),
      };
    }

    function createPrivateSubnets() {
      const ret = zones.apply((zones) =>
        zones.map((zone, i) => {
          const subnet = new ec2.Subnet(
            ...transform(
              args?.transform?.privateSubnet,
              `${name}PrivateSubnet${i + 1}`,
              {
                vpcId: vpc.id,
                cidrBlock: `10.0.${zones.length + i + 1}.0/24`,
                availabilityZone: zone,
              },
              { parent },
            ),
          );

          const routeTable = new ec2.RouteTable(
            ...transform(
              args?.transform?.privateRouteTable,
              `${name}PrivateRouteTable${i + 1}`,
              {
                vpcId: vpc.id,
                routes: [
                  {
                    cidrBlock: "0.0.0.0/0",
                    natGatewayId: natGateways[i].id,
                  },
                ],
              },
              { parent },
            ),
          );

          new ec2.RouteTableAssociation(
            `${name}PrivateRouteTableAssociation${i + 1}`,
            {
              subnetId: subnet.id,
              routeTableId: routeTable.id,
            },
            { parent },
          );

          return { subnet, routeTable };
        }),
      );

      return {
        privateSubnets: ret.apply((ret) => ret.map((r) => r.subnet)),
        privateRouteTables: ret.apply((ret) => ret.map((r) => r.routeTable)),
      };
    }
  }

  /**
   * The VPC ID.
   */
  public get id() {
    return this.vpc.id;
  }

  /**
   * A list of public subnet IDs in the VPC.
   */
  public get publicSubnets() {
    return this._publicSubnets.apply((subnets) =>
      subnets.map((subnet) => subnet.id),
    );
  }

  /**
   * A list of private subnet IDs in the VPC.
   */
  public get privateSubnets() {
    return this._privateSubnets.apply((subnets) =>
      subnets.map((subnet) => subnet.id),
    );
  }

  /**
   * A list of VPC security group IDs.
   */
  public get securityGroups() {
    return [this.securityGroup.id];
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The Amazon EC2 VPC.
       */
      vpc: this.vpc,
      /**
       * The Amazon EC2 Internet Gateway.
       */
      internetGateway: this.internetGateway,
      /**
       * The Amazon EC2 Security Group.
       */
      securityGroup: this.securityGroup,
      /**
       * The Amazon EC2 NAT Gateway.
       */
      natGateways: this.natGateways,
      /**
       * The Amazon EC2 Elastic IP.
       */
      elasticIps: this.elasticIps,
      /**
       * The Amazon EC2 public subnet.
       */
      publicSubnets: this._publicSubnets,
      /**
       * The Amazon EC2 private subnet.
       */
      privateSubnets: this._privateSubnets,
      /**
       * The Amazon EC2 route table for the public subnet.
       */
      publicRouteTables: this.publicRouteTables,
      /**
       * The Amazon EC2 route table for the private subnet.
       */
      privateRouteTables: this.privateRouteTables,
    };
  }

  /**
   * Reference an existing VPC with the given ID. This is useful when you
   * create a VPC in one stage and want to share it in another stage. It avoids having to
   * create a new VPC in the other stage.
   *
   * :::tip
   * You can use the `static get` method to share VPCs across stages.
   * :::
   *
   * @param name The name of the component.
   * @param vpcID The ID of the existing VPC.
   *
   * @example
   * Imagine you create a VPC in the `dev` stage. And in your personal stage `frank`,
   * instead of creating a new VPC, you want to share the VPC from `dev`.
   *
   * ```ts title="sst.config.ts"
   * const vpc = $app.stage === "frank"
   *   ? sst.aws.Vpc.v1.get("MyVPC", "vpc-0be8fa4de860618bb")
   *   : new sst.aws.Vpc.v1("MyVPC");
   * ```
   *
   * Here `vpc-0be8fa4de860618bb` is the ID of the VPC created in the `dev` stage.
   * You can find this by outputting the VPC ID in the `dev` stage.
   *
   * ```ts title="sst.config.ts"
   * return {
   *   vpc: vpc.id
   * };
   * ```
   */
  public static get(name: string, vpcID: Input<string>) {
    const vpc = ec2.Vpc.get(`${name}Vpc`, vpcID);
    const internetGateway = ec2.InternetGateway.get(
      `${name}InstanceGateway`,
      ec2.getInternetGatewayOutput({
        filters: [{ name: "attachment.vpc-id", values: [vpc.id] }],
      }).internetGatewayId,
    );
    const securityGroup = ec2.SecurityGroup.get(
      `${name}SecurityGroup`,
      ec2
        .getSecurityGroupsOutput({
          filters: [
            { name: "group-name", values: ["*SecurityGroup*"] },
            { name: "vpc-id", values: [vpc.id] },
          ],
        })
        .ids.apply((ids) => {
          if (!ids.length)
            throw new Error(`Security group not found in VPC ${vpcID}`);
          return ids[0];
        }),
    );
    const privateSubnets = ec2
      .getSubnetsOutput({
        filters: [
          { name: "vpc-id", values: [vpc.id] },
          { name: "tag:Name", values: ["*Private*"] },
        ],
      })
      .ids.apply((ids) =>
        ids.map((id, i) => ec2.Subnet.get(`${name}PrivateSubnet${i + 1}`, id)),
      );
    const privateRouteTables = privateSubnets.apply((subnets) =>
      subnets.map((subnet, i) =>
        ec2.RouteTable.get(
          `${name}PrivateRouteTable${i + 1}`,
          ec2.getRouteTableOutput({ subnetId: subnet.id }).routeTableId,
        ),
      ),
    );
    const publicSubnets = ec2
      .getSubnetsOutput({
        filters: [
          { name: "vpc-id", values: [vpc.id] },
          { name: "tag:Name", values: ["*Public*"] },
        ],
      })
      .ids.apply((ids) =>
        ids.map((id, i) => ec2.Subnet.get(`${name}PublicSubnet${i + 1}`, id)),
      );
    const publicRouteTables = publicSubnets.apply((subnets) =>
      subnets.map((subnet, i) =>
        ec2.RouteTable.get(
          `${name}PublicRouteTable${i + 1}`,
          ec2.getRouteTableOutput({ subnetId: subnet.id }).routeTableId,
        ),
      ),
    );
    const natGateways = publicSubnets.apply((subnets) =>
      subnets.map((subnet, i) =>
        ec2.NatGateway.get(
          `${name}NatGateway${i + 1}`,
          ec2.getNatGatewayOutput({ subnetId: subnet.id }).id,
        ),
      ),
    );
    const elasticIps = natGateways.apply((nats) =>
      nats.map((nat, i) =>
        ec2.Eip.get(
          `${name}ElasticIp${i + 1}`,
          nat.allocationId as Output<string>,
        ),
      ),
    );

    return new Vpc(name, {
      ref: true,
      vpc,
      internetGateway,
      securityGroup,
      privateSubnets,
      privateRouteTables,
      publicSubnets,
      publicRouteTables,
      natGateways,
      elasticIps,
    } satisfies VpcRef as VpcArgs);
  }
}

const __pulumiType = "sst:aws:Vpc";
// @ts-expect-error
Vpc.__pulumiType = __pulumiType;
