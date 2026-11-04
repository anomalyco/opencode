//! Flowchart model (`flowchart/types.ts`).

use std::rc::Rc;

use crate::core::geometry::{Axis, Bounds, Point};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FlowDirection {
    TB,
    TD,
    BT,
    LR,
    RL,
}

impl FlowDirection {
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value.to_ascii_uppercase().as_str() {
            "TB" => Self::TB,
            "TD" => Self::TD,
            "BT" => Self::BT,
            "LR" => Self::LR,
            "RL" => Self::RL,
            _ => return None,
        })
    }

    pub fn horizontal(self) -> bool {
        matches!(self, Self::LR | Self::RL)
    }

    pub fn vertical(self) -> bool {
        !self.horizontal()
    }

    /// RL and BT, whose ranks run against the axis.
    pub fn reversed(self) -> bool {
        matches!(self, Self::RL | Self::BT)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shape {
    Box,
    Rounded,
    Database,
    Decision,
    Subroutine,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EdgeStyle {
    Thick,
    Dashed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Node {
    pub id: String,
    pub label: String,
    pub shape: Shape,
}

/// An edge. `id` is its position in the parsed diagram; copies keep it, and TS compares edges by object
/// identity, which this stands for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Edge {
    pub id: usize,
    pub from: String,
    pub to: String,
    pub label: String,
    pub style: Option<EdgeStyle>,
    pub arrowhead: bool,
    pub source_arrowhead: bool,
    pub order_only: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Subgraph {
    pub id: String,
    pub label: String,
    pub node_ids: Vec<String>,
    pub parent_id: Option<String>,
    pub direction: Option<FlowDirection>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Diagram {
    pub direction: FlowDirection,
    pub nodes: Vec<Node>,
    pub edges: Vec<Rc<Edge>>,
    pub subgraphs: Vec<Subgraph>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NodeBounds {
    pub id: String,
    pub bounds: Bounds,
    pub lines: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LabelSide {
    Top,
    Bottom,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SubgraphBounds {
    pub id: String,
    pub label: String,
    pub bounds: Bounds,
    pub label_side: LabelSide,
}

/// A node or a subgraph frame an edge starts or ends at.
#[derive(Clone, Copy, Debug)]
pub enum Endpoint<'a> {
    Node(&'a NodeBounds),
    Subgraph(&'a SubgraphBounds),
}

impl<'a> Endpoint<'a> {
    pub fn id(&self) -> &'a str {
        match self {
            Self::Node(node) => &node.id,
            Self::Subgraph(subgraph) => &subgraph.id,
        }
    }

    pub fn bounds(&self) -> &'a Bounds {
        match self {
            Self::Node(node) => &node.bounds,
            Self::Subgraph(subgraph) => &subgraph.bounds,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Route {
    pub edge: Rc<Edge>,
    pub points: Vec<Point>,
    pub label_axis: Option<Axis>,
    pub label_point: Option<Point>,
}

impl Route {
    pub fn new(edge: Rc<Edge>, points: Vec<Point>) -> Self {
        Self {
            edge,
            points,
            label_axis: None,
            label_point: None,
        }
    }
}
